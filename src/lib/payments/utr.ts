/**
 * UTR verification adapters.
 *
 * A top-up is only ever credited when a verifier returns MATCHED *and* the operator has
 * turned on auto-credit for that method. Every other outcome - not found, wrong amount,
 * network failure, missing credentials - leaves the request PENDING for a human. The
 * adapters below are therefore written to fail closed: any unexpected condition maps to
 * ERROR, never to MATCHED.
 *
 * Aggregator credentials are read from environment variables only. They must never be
 * written to `payment_methods`, which is readable by every signed-in customer so the
 * top-up screen can render the QR.
 */

export type VerificationState =
  | 'NOT_CHECKED'
  | 'MATCHED'
  | 'AMOUNT_MISMATCH'
  | 'NOT_FOUND'
  | 'ERROR';

export type VerificationMode = 'MANUAL' | 'DECENTRO';

export interface UtrVerificationRequest {
  /** 12-digit UTR exactly as the customer typed it (already format-validated). */
  utr: string;
  /** Amount in rupees the customer claims to have paid. */
  amount: number;
  /** Ignore bank credits older than this. Bounds how far back a stale UTR can reach. */
  since: Date;
}

export interface UtrVerificationResult {
  state: VerificationState;
  /** What the bank actually received, when the aggregator reported a figure. */
  verifiedAmount?: number;
  /** Short operator-facing explanation. Must never contain credentials or raw payloads. */
  note: string;
}

export interface UtrVerifier {
  readonly mode: VerificationMode;
  /** False when required environment variables are missing. */
  readonly isConfigured: boolean;
  verify(request: UtrVerificationRequest): Promise<UtrVerificationResult>;
}

/** Paise-level tolerance. Bank statements round to 2dp; anything beyond that is a mismatch. */
const AMOUNT_EPSILON = 0.01;

function amountsMatch(claimed: number, actual: number): boolean {
  return Math.abs(claimed - actual) < AMOUNT_EPSILON;
}

/**
 * Default mode. Records nothing automatically - an administrator compares the UTR against
 * the bank statement and presses Approve.
 */
const manualVerifier: UtrVerifier = {
  mode: 'MANUAL',
  isConfigured: true,
  async verify(): Promise<UtrVerificationResult> {
    return {
      state: 'NOT_CHECKED',
      note: 'Awaiting manual verification against the bank statement.',
    };
  },
};

/**
 * Decentro bank-statement lookup.
 *
 * Endpoint and response shape are driven by environment variables because Decentro issues
 * different module paths per account. Confirm the values against your own API console
 * before switching a method to DECENTRO - until then leave the method on MANUAL.
 *
 *   DECENTRO_BASE_URL         e.g. https://in.staging.decentro.tech
 *   DECENTRO_CLIENT_ID
 *   DECENTRO_CLIENT_SECRET
 *   DECENTRO_MODULE_SECRET
 *   DECENTRO_PROVIDER_SECRET  (optional, required by some modules)
 *   DECENTRO_ACCOUNT_NUMBER   virtual/collection account the QR settles into
 *   DECENTRO_STATEMENT_PATH   optional override, defaults to the core-banking statement path
 */
const DECENTRO_TIMEOUT_MS = 10_000;

function decentroConfig() {
  return {
    baseUrl: process.env.DECENTRO_BASE_URL,
    clientId: process.env.DECENTRO_CLIENT_ID,
    clientSecret: process.env.DECENTRO_CLIENT_SECRET,
    moduleSecret: process.env.DECENTRO_MODULE_SECRET,
    providerSecret: process.env.DECENTRO_PROVIDER_SECRET,
    accountNumber: process.env.DECENTRO_ACCOUNT_NUMBER,
    statementPath:
      process.env.DECENTRO_STATEMENT_PATH || '/core_banking/money_transfer/get_transaction_status',
  };
}

type DecentroEntry = {
  transactionAmount?: number | string;
  amount?: number | string;
  transactionType?: string;
  type?: string;
  utr?: string;
  bankReferenceNumber?: string;
  transactionId?: string;
};

/** Decentro nests the useful rows differently per module, so probe the known shapes. */
function extractEntries(payload: unknown): DecentroEntry[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const candidates = [root.data, root.transactions, root.transactionStatus, root.result];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as DecentroEntry[];
    if (candidate && typeof candidate === 'object') return [candidate as DecentroEntry];
  }
  return [];
}

function entryUtr(entry: DecentroEntry): string {
  return String(entry.utr ?? entry.bankReferenceNumber ?? entry.transactionId ?? '').trim();
}

function entryAmount(entry: DecentroEntry): number {
  return Number(entry.transactionAmount ?? entry.amount ?? NaN);
}

const decentroVerifier: UtrVerifier = {
  mode: 'DECENTRO',

  get isConfigured(): boolean {
    const cfg = decentroConfig();
    return Boolean(
      cfg.baseUrl && cfg.clientId && cfg.clientSecret && cfg.moduleSecret && cfg.accountNumber,
    );
  },

  async verify({ utr, amount, since }: UtrVerificationRequest): Promise<UtrVerificationResult> {
    const cfg = decentroConfig();

    if (!decentroVerifier.isConfigured) {
      return {
        state: 'ERROR',
        note: 'Decentro credentials are not configured on the server. Falling back to manual review.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DECENTRO_TIMEOUT_MS);

    try {
      const url = new URL(cfg.statementPath, cfg.baseUrl);
      url.searchParams.set('account_number', cfg.accountNumber!);
      url.searchParams.set('reference_number', utr);
      url.searchParams.set('from_date', since.toISOString().slice(0, 10));

      const headers: Record<string, string> = {
        client_id: cfg.clientId!,
        client_secret: cfg.clientSecret!,
        module_secret: cfg.moduleSecret!,
        Accept: 'application/json',
      };
      if (cfg.providerSecret) headers.provider_secret = cfg.providerSecret;

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        // Deliberately does not echo the body - it can carry account identifiers.
        return {
          state: 'ERROR',
          note: `Bank lookup failed with status ${response.status}. Verify manually.`,
        };
      }

      const entries = extractEntries(await response.json());
      const match = entries.find((entry) => entryUtr(entry) === utr);

      if (!match) {
        return {
          state: 'NOT_FOUND',
          note: 'No bank credit found against this UTR in the selected period.',
        };
      }

      const actual = entryAmount(match);
      if (!Number.isFinite(actual)) {
        return {
          state: 'ERROR',
          note: 'Bank returned a credit for this UTR without a readable amount. Verify manually.',
        };
      }

      if (!amountsMatch(amount, actual)) {
        return {
          state: 'AMOUNT_MISMATCH',
          verifiedAmount: actual,
          note: `Bank received Rs ${actual.toFixed(2)} but Rs ${amount.toFixed(2)} was claimed.`,
        };
      }

      return {
        state: 'MATCHED',
        verifiedAmount: actual,
        note: `Bank credit of Rs ${actual.toFixed(2)} matched against this UTR.`,
      };
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        state: 'ERROR',
        note: aborted
          ? 'Bank lookup timed out. Verify manually.'
          : 'Bank lookup could not be completed. Verify manually.',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

const VERIFIERS: Record<VerificationMode, UtrVerifier> = {
  MANUAL: manualVerifier,
  DECENTRO: decentroVerifier,
};

export function getVerifier(mode: string | null | undefined): UtrVerifier {
  return VERIFIERS[(mode as VerificationMode) ?? 'MANUAL'] ?? manualVerifier;
}

/**
 * The single place that decides whether a request may be credited without a human.
 * Anything other than an exact match under an explicitly enabled auto-credit policy is a no.
 */
export function canAutoCredit(
  result: UtrVerificationResult,
  autoCreditEnabled: boolean,
): boolean {
  return autoCreditEnabled && result.state === 'MATCHED';
}

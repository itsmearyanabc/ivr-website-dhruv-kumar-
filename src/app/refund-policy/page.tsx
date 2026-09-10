import type { Metadata } from "next";
import LegalPage, { Fill } from "@/app/_components/LegalPage";

export const metadata: Metadata = {
  title: "Refund Policy | BulkShout",
  description:
    "BulkShout charges only for calls that connect and SMS that deliver. How refunds work, and when.",
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="10 September 2026"
      intro={
        <>
          BulkShout operates on a prepaid, pay-for-delivery model. This policy explains exactly
          when and how refunds are issued.
        </>
      }
    >
      <h2>1. Our Core Refund Principle: No Answer, No Charge</h2>
      <p>
        We only charge you for calls that are actually <strong>connected/answered</strong> and
        SMS that are actually <strong>delivered</strong>.
      </p>
      <ul>
        <li>
          If a call fails to connect (switched off, unreachable, invalid number, no answer,
          network failure), the corresponding amount is{" "}
          <strong>automatically refunded to your BulkShout wallet</strong>.
        </li>
        <li>
          If an SMS fails to deliver, the corresponding amount is{" "}
          <strong>automatically refunded to your BulkShout wallet</strong>.
        </li>
        <li>
          You do not need to raise a request or ticket for this &mdash; refunds for failed calls
          and SMS are processed automatically as part of your campaign report.
        </li>
      </ul>

      <h2>2. How Refunds Are Issued</h2>
      <p>
        All refunds under this policy are credited back as <strong>wallet balance</strong>, not
        as a cash transfer to your original payment method. Your wallet balance:
      </p>
      <ul>
        <li>
          Has <strong>lifetime validity</strong> &mdash; it does not expire
        </li>
        <li>Can be used toward any future campaign, of any service type</li>
        <li>Is shown transparently in your delivery report against every broadcast</li>
      </ul>

      <h2>3. Wallet Top-Up Refunds</h2>
      <p>
        Funds added to your wallet via UPI or other supported payment methods are intended for
        use on BulkShout campaigns.
      </p>
      <ul>
        <li>
          Unused wallet balance may be eligible for a refund to your original payment method{" "}
          <strong>
            only if requested within <Fill>Insert Number</Fill> days of the top-up
          </strong>
          , and <strong>only for the unused portion</strong> of that top-up.
        </li>
        <li>
          Once wallet balance has been used to place a broadcast order, that portion is
          non-refundable to your original payment method (though failed-delivery amounts within
          that order are still refunded to your wallet as per Section 1).
        </li>
        <li>
          To request a wallet balance refund, contact our support team at{" "}
          <a href="mailto:Bulkshout@gmail.com">Bulkshout@gmail.com</a> with your account details and the top-up reference.
        </li>
      </ul>

      <h2>4. Campaigns That Are Not Eligible for Refund</h2>
      <p>Refunds do not apply to:</p>
      <ul>
        <li>
          Calls that connected and successfully played your message, even if the outcome (e.g.,
          no response, no press-1 action) was not what you expected
        </li>
        <li>SMS that were successfully delivered to the handset</li>
        <li>
          Campaigns where the contact list, script, or recording provided by you contained
          errors on your end
        </li>
        <li>
          Charges for optional add-on services (such as AI voice generation) once the work has
          been completed and delivered to you
        </li>
      </ul>

      <h2>5. Cancellations</h2>
      <ul>
        <li>
          A broadcast that has not yet started processing can typically be cancelled or modified
          by contacting support before it enters the &ldquo;in progress&rdquo; stage.
        </li>
        <li>
          Once a broadcast has started processing, only the undelivered/unconnected portion is
          refundable, per Section 1.
        </li>
      </ul>

      <h2>6. Disputes</h2>
      <p>
        If you believe a refund has been calculated incorrectly, contact our support team within{" "}
        <Fill>Insert Number</Fill> days of the campaign&rsquo;s completion with your Broadcast
        ID. We will review your delivery report and resolve the matter promptly.
      </p>

      <h2>7. Contact Us</h2>
      <p>
        <strong>Email:</strong> <a href="mailto:Bulkshout@gmail.com">Bulkshout@gmail.com</a>
        <br />
        <strong>Phone:</strong> <a href="tel:+918826171727">+91 88261 71727</a>
        <br />
        <strong>Working Hours:</strong> 9:00 AM &ndash; 7:00 PM, Monday to Saturday
      </p>
    </LegalPage>
  );
}

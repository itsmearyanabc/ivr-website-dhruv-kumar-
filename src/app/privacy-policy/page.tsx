import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | BulkShout",
  description:
    "What BulkShout collects, how your contact lists are handled, and your rights over your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="10 September 2026"
      intro={
        <>
          BulkShout (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) provides bulk voice
          call and SMS broadcasting services to businesses across India. This Privacy Policy
          explains what information we collect, how we use it, and how we protect it when you
          use our platform. By creating an account or using our services, you agree to the terms
          of this Privacy Policy.
        </>
      }
    >
      <h2>1. Information We Collect</h2>
      <h3>a) Account Information</h3>
      <p>
        When you create an account, we collect your name, business name, email address, phone
        number, and billing details necessary to operate your account and process payments.
      </p>
      <h3>b) Contact List Information</h3>
      <p>
        When you submit a campaign, you provide us with a contact list &mdash; the phone numbers
        you want to reach through your voice call or SMS broadcast. We process this contact list
        solely to deliver your campaign.
      </p>
      <h3>c) Campaign Content</h3>
      <p>
        This includes any script, recorded audio, or message text you provide for your
        broadcast.
      </p>
      <h3>d) Payment Information</h3>
      <p>
        Wallet top-ups are processed through third-party payment gateways (such as UPI
        providers). We do not store your full payment card or bank details on our servers.
      </p>
      <h3>e) Usage Data</h3>
      <p>
        We automatically collect basic technical information such as IP address, browser type,
        and platform usage logs to maintain security and improve our service.
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>We use the information collected to:</p>
      <ul>
        <li>Set up, run, and deliver your voice call or SMS campaigns</li>
        <li>Process wallet top-ups and generate accurate billing</li>
        <li>Provide delivery reports and campaign tracking</li>
        <li>Generate AI-based voice recordings from scripts you provide, when requested</li>
        <li>Respond to support requests</li>
        <li>Improve our platform&rsquo;s reliability and features</li>
        <li>Communicate service updates, campaign status, and account notifications</li>
      </ul>

      <h2>3. How We Handle Your Contact Lists</h2>
      <p>Your contact list belongs to you. We do not:</p>
      <ul>
        <li>Sell your contact list to any third party</li>
        <li>
          Use your contact list for any purpose other than delivering the campaign you have
          requested
        </li>
        <li>Share your contact list with other customers or unrelated businesses</li>
        <li>
          Retain your contact list for longer than necessary to complete and report on your
          campaign, unless you ask us to keep it on file for repeat campaigns
        </li>
      </ul>
      <p>
        You are responsible for ensuring you have the right to contact the phone numbers you
        submit to us for a campaign.
      </p>

      <h2>4. Sharing of Information</h2>
      <p>
        We do not sell your personal information or your contact lists. We may share limited
        information with:
      </p>
      <ul>
        <li>
          <strong>Telecom and delivery partners</strong> &mdash; solely to route and deliver
          your calls/SMS
        </li>
        <li>
          <strong>Payment processors</strong> &mdash; solely to process wallet top-ups
        </li>
        <li>
          <strong>Law enforcement or regulatory authorities</strong> &mdash; only where required
          by applicable law
        </li>
      </ul>

      <h2>5. Data Security</h2>
      <p>
        We take reasonable technical and organizational measures to protect your account
        information and contact lists from unauthorized access, alteration, or disclosure.
        However, no method of transmission or storage is 100% secure, and we cannot guarantee
        absolute security.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain your account information for as long as your account is active. Campaign-level
        contact lists and reports are retained for a reasonable period to support reporting,
        refunds, and dispute resolution, after which they may be deleted or anonymized.
      </p>

      <h2>7. Your Rights</h2>
      <p>You may:</p>
      <ul>
        <li>Request access to the personal information we hold about you</li>
        <li>Request correction of inaccurate account information</li>
        <li>
          Request deletion of your account and associated data, subject to any records we are
          legally required to retain
        </li>
        <li>Withdraw consent for future communications from us at any time</li>
      </ul>
      <p>
        To exercise these rights, contact us at <a href="mailto:Bulkshout@gmail.com">Bulkshout@gmail.com</a>.
      </p>

      <h2>8. Cookies</h2>
      <p>
        Our website may use cookies or similar technologies to remember your login session and
        improve your browsing experience. You can control cookie preferences through your
        browser settings.
      </p>

      <h2>9. Children&rsquo;s Privacy</h2>
      <p>
        BulkShout is intended for use by businesses and individuals aged 18 and above. We do not
        knowingly collect information from minors.
      </p>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Any changes will be posted on this
        page with an updated &ldquo;Last updated&rdquo; date. Continued use of our services
        after changes are posted constitutes acceptance of the revised policy.
      </p>

      <h2>11. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy or how your data is handled, contact us
        at:
      </p>
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

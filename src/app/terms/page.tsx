import type { Metadata } from "next";
import LegalPage from "@/app/_components/LegalPage";

export const metadata: Metadata = {
  title: "Terms and Conditions | BulkShout",
  description:
    "The terms governing use of BulkShout's bulk voice call and SMS broadcasting service.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      updated="10 September 2026"
      intro={
        <>
          Please read these Terms and Conditions (&ldquo;Terms&rdquo;) carefully before using
          BulkShout. By creating an account or using our services, you agree to be bound by
          these Terms.
        </>
      }
    >
      <h2>1. About BulkShout</h2>
      <p>
        BulkShout provides bulk voice call broadcasting and bulk SMS broadcasting services to
        businesses across India, allowing you to reach large contact lists with pre-recorded
        voice messages, interactive voice response (IVR) campaigns, or SMS messages.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old and legally able to enter into a binding agreement to
        use BulkShout. By using our services, you confirm that you are using them on behalf of a
        legitimate business or organization.
      </p>

      <h2>3. Account Registration</h2>
      <p>You are responsible for:</p>
      <ul>
        <li>Providing accurate account information</li>
        <li>Keeping your login credentials confidential</li>
        <li>All activity that takes place under your account</li>
      </ul>
      <p>
        Notify us immediately at <a href="mailto:Bulkshout@gmail.com">Bulkshout@gmail.com</a> if you suspect unauthorized
        use of your account.
      </p>

      <h2>4. Your Responsibilities Regarding Contact Lists and Content</h2>
      <p>
        When you upload a contact list or submit a script/recording for a campaign, you confirm
        that:
      </p>
      <ul>
        <li>The contact list is your own or one you are authorized to use for the stated purpose</li>
        <li>You have the right to contact the numbers on your list for the purpose of your campaign</li>
        <li>
          Your campaign content (script, recording, or SMS text) does not violate any applicable
          law, infringe any third party&rsquo;s rights, or contain misleading, fraudulent,
          defamatory, obscene, or unlawful material
        </li>
        <li>
          You will not use BulkShout for spam, harassment, impersonation, or any activity
          intended to deceive or harm recipients
        </li>
      </ul>
      <p>
        BulkShout reserves the right to review, reject, or halt any campaign that it reasonably
        believes violates these Terms, without liability to you.
      </p>
      <p>
        You are solely responsible for ensuring your campaigns comply with all applicable laws
        and regulations governing commercial communications in India.
      </p>

      <h2>5. Services We Provide</h2>
      <p>Depending on the service you select, BulkShout will:</p>
      <ul>
        <li>Process your contact list and campaign content</li>
        <li>
          Generate a voice recording from your script using AI voice generation, where
          requested, at no additional charge
        </li>
        <li>Execute the voice call or SMS broadcast to your contact list</li>
        <li>Provide a delivery report showing connected/delivered vs. failed attempts</li>
        <li>
          Apply automatic wallet refunds for failed calls or undelivered SMS, per our{" "}
          <a href="/refund-policy">Refund Policy</a>
        </li>
      </ul>

      <h2>6. Pricing and Payment</h2>
      <ul>
        <li>
          BulkShout operates on a <strong>prepaid wallet model</strong>. You must maintain
          sufficient wallet balance to place a campaign order.
        </li>
        <li>
          Pricing varies by service type, call/message volume, and recording duration, and is
          displayed to you before you confirm any order.
        </li>
        <li>
          There is <strong>no setup fee</strong> for using BulkShout.
        </li>
        <li>
          Wallet balance has <strong>lifetime validity</strong> and is not subject to forced
          monthly minimums or automatic deduction.
        </li>
        <li>
          All charges and refunds are detailed further in our{" "}
          <a href="/refund-policy">Refund Policy</a>.
        </li>
      </ul>

      <h2>7. Campaign Scheduling and Delivery</h2>
      <ul>
        <li>
          Campaigns are generally processed within our standard working hours:{" "}
          <strong>9:00 AM &ndash; 7:00 PM, Monday to Saturday</strong>.
        </li>
        <li>
          Campaigns requested for holidays or outside standard working hours may be accommodated
          on request, subject to a minimum order size and additional terms communicated at the
          time of booking.
        </li>
        <li>
          While we make reasonable efforts to deliver campaigns promptly and accurately,
          delivery timing and connection rates can be affected by factors outside our control,
          including telecom network conditions, recipient device status, and third-party carrier
          performance.
        </li>
      </ul>

      <h2>8. Prohibited Uses</h2>
      <p>You may not use BulkShout to:</p>
      <ul>
        <li>
          Send unsolicited communications to individuals who have not consented to being
          contacted for the relevant purpose
        </li>
        <li>Distribute content that is illegal, defamatory, threatening, fraudulent, or misleading</li>
        <li>Impersonate any person, business, or brand</li>
        <li>
          Interfere with or disrupt BulkShout&rsquo;s platform, infrastructure, or other
          users&rsquo; campaigns
        </li>
        <li>
          Violate any applicable Indian law governing telecom communications, consumer
          protection, or data privacy
        </li>
      </ul>
      <p>
        Violation of this section may result in immediate suspension or termination of your
        account, forfeiture of remaining wallet balance related to the violating campaign, and
        cooperation with relevant authorities where required by law.
      </p>

      <h2>9. Intellectual Property</h2>
      <p>
        All content on the BulkShout platform &mdash; including our branding, website design,
        and software &mdash; is owned by BulkShout and may not be copied, reproduced, or used
        without our written permission. You retain ownership of the content and contact lists
        you submit to us.
      </p>

      <h2>10. Limitation of Liability</h2>
      <p>
        BulkShout provides its services on an &ldquo;as available&rdquo; basis. To the maximum
        extent permitted by law:
      </p>
      <ul>
        <li>
          We are not liable for indirect, incidental, or consequential damages arising from your
          use of the platform
        </li>
        <li>
          We are not liable for the outcome of your marketing or communication campaigns (such
          as customer response rates or business results)
        </li>
        <li>
          Our total liability for any claim relating to a specific campaign is limited to the
          amount you paid for that campaign
        </li>
      </ul>

      <h2>11. Account Suspension and Termination</h2>
      <p>
        We may suspend or terminate your account if you violate these Terms, misuse the
        platform, or engage in fraudulent activity. You may close your account at any time by
        contacting support; any eligible refund of unused wallet balance will be processed per
        our <a href="/refund-policy">Refund Policy</a>.
      </p>

      <h2>12. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of BulkShout after changes
        are posted constitutes your acceptance of the revised Terms. Material changes will be
        communicated via email or platform notification where reasonably possible.
      </p>

      <h2>13. Governing Law</h2>
      <p>
        These Terms are governed by the laws of India. Any disputes arising from these Terms or
        your use of BulkShout shall be subject to the exclusive jurisdiction of the courts of{" "}
        Delhi.
      </p>

      <h2>14. Contact Us</h2>
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

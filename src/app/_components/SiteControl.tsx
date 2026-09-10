/**
 * GetSiteControl widgets (pop-ups, surveys, chat prompts).
 *
 * A plain <script> tag in a server component, not next/script. next/script injects the tag
 * from JavaScript after the page loads, which works - the widget ran - but leaves nothing in
 * the HTML the server sends, so "View page source" shows no trace of it and it looks removed.
 * Rendered this way the tag is in the delivered markup, exactly as Getsitecontrol supply it.
 *
 * `async` keeps it off the critical path: the browser fetches it without blocking parsing or
 * first paint, which is what protects the page speed.
 *
 * Not a client component - there is no interactivity here, so this ships no JavaScript of its
 * own. Mounted on the customer-facing surfaces only and never on /admin: an operator working
 * the console all day should not be shown marketing pop-ups, and their sessions should not
 * count towards what the widget measures.
 */

export default function SiteControl() {
  return (
    <script
      async
      src="https://l.getsitecontrol.com/468nded7.js"
    />
  );
}

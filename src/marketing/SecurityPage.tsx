import { ProsePage } from './ProsePage';

export function SecurityPage() {
  return (
    <ProsePage
      title="Security"
      standfirst="What protects your books, described plainly enough that you can check it. This page claims no certifications, because Ledger Link holds none yet."
    >
      <h2>Tenant isolation is enforced by the database</h2>
      <p>
        Every table carrying business data has row-level security policies keyed to organization
        membership. A query for one organization&rsquo;s invoices cannot return another&rsquo;s,
        because Postgres refuses the rows rather than because a filter was remembered in
        application code. Requests additionally carry an organization identifier that is validated
        against your membership on every call, and a malformed identifier is rejected before it
        reaches the database.
      </p>

      <h2>Roles</h2>
      <p>
        An organization has owners, admins and members. The owner cannot be removed or demoted by
        anyone else, which prevents an admin from locking a business out of its own books. Role
        changes and member removals are written to the audit log with the acting user attached.
      </p>

      <h2>The audit log is not optional</h2>
      <p>
        Creates, updates and deletes on business records write an audit event carrying the actor,
        the organization, the resource, the timestamp and the changed fields. It is visible inside
        the product rather than being an internal table you have to ask for.
      </p>

      <h2>Credentials</h2>
      <p>
        Authentication is email and password through Supabase Auth. Passwords are hashed by
        Supabase and never reach our application code or our logs. API keys with elevated
        privileges exist only in the server runtime as encrypted secrets and are never sent to the
        browser. The Gemini key used for receipt scanning is server-side only, so receipt images
        are processed through our backend rather than posted to Google from your device.
      </p>

      <h2>Transport and headers</h2>
      <p>
        The application is served over TLS from Cloudflare&rsquo;s edge. Responses carry a content
        security policy restricting script and style sources, alongside nosniff, deny-framing and
        no-referrer headers. Cross-origin requests are allowed only from an explicit list of
        origins.
      </p>

      <h2>Error messages do not leak schema</h2>
      <p>
        Server errors return a generic message to the browser and log the detail server-side.
        Database constraint names, column names and query text are never forwarded to a client,
        because they are a map of the schema for anyone probing it.
      </p>

      <h2>Where the data lives, and what we have not done</h2>
      <p>
        Business data is held in a managed Postgres instance with automated backups and
        point-in-time recovery, and application code runs at Cloudflare&rsquo;s edge. Ledger Link
        has not completed a SOC 2, ISO 27001 or third-party penetration test, and has not been
        through an external security audit. Registration with the Office of the Data Protection
        Commissioner is in progress. If any of that is a procurement requirement for you, it is
        not met today, and you should say so before you commit.
      </p>
    </ProsePage>
  );
}

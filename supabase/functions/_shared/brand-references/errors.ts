// Why learning a client's design style could not finish. The code is what the
// client lifecycle acts on (wait for an input, try again later); the message
// is plain enough to show a person.

export type StyleErrorCode =
  | "no_accounts" // no social accounts assigned yet: waits for them
  | "too_few" // fewer than 3 designed posts to learn from: waits for more posts
  | "no_sources" // nothing to read (no references and no brand book)
  | "accounts_changed" // the accounts changed while it ran: runs again with the new ones
  | "provider"; // Sprout, storage or the model failed: tried again later

export class StyleError extends Error {
  constructor(public code: StyleErrorCode, message: string) {
    super(message);
    this.name = "StyleError";
  }
}

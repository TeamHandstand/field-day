// Admins allowed to delete an entire event. Deleting an event is destructive and
// irreversible, so it's gated to these accounts both in the UI and on the API.
export const EVENT_DELETE_ALLOWED_EMAILS = [
  "sam@handstandwith.us",
  "kaitlin@handstandwith.us",
];

export function canDeleteEvent(email: string | undefined | null): boolean {
  if (!email) return false;
  return EVENT_DELETE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

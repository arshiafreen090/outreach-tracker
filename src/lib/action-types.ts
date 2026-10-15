export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; code?: "already_messaged" };

/** State shape for forms driven by useActionState. `nonce` changes on every success so forms can reset. */
export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
  nonce?: number;
}

export interface MarkSentInput {
  personId: string;
  templateId: string;
  templateVersion: number;
  finalText: string;
  allowDuplicate: boolean;
}

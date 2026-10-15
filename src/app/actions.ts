"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, FormState, MarkSentInput } from "@/lib/action-types";
import { isAllowedEmail } from "@/lib/auth-rules";
import { getAuthedClient } from "@/lib/auth";
import { isCompanyCategory, type CompanyCategory } from "@/lib/categories";
import { parseDaysInput } from "@/lib/settings";
import { isPersonStatus } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { findUnknownPlaceholders } from "@/lib/templates/engine";
import { dateInputToDate } from "@/lib/time";
import { parseProfileUrl } from "@/lib/urls";
import { field, isUuid, MAX_MESSAGE_TEXT, MAX_SHORT_TEXT } from "@/lib/validate";

// Server actions are public POST endpoints and the proxy does not cover them,
// so every action re-checks the user itself.
const SIGNED_OUT = "You're signed out. Reload the page and sign in again.";
const refresh = () => revalidatePath("/", "layout");
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const categoryOrDefault = (raw: string): CompanyCategory => (isCompanyCategory(raw) ? raw : "other_relevant");

// ---------------------------------------------------------------- auth

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = field(formData, "email");
  const password = typeof formData.get("password") === "string" ? (formData.get("password") as string) : "";
  const generic = { error: "Invalid email or password." };

  // Anyone but the allowed user never reaches Supabase Auth at all.
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL) || !password) return generic;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return generic;
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------- people

export async function logRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };

  const fullName = field(formData, "full_name");
  const role = field(formData, "role");
  const company = field(formData, "company");
  const sentOn = field(formData, "sent_on");
  if (!fullName) return { error: "Name is required." };
  if ([fullName, role, company].some((v) => v.length > MAX_SHORT_TEXT)) return { error: "Name, role and company must be under 200 characters." };

  const profile = parseProfileUrl(field(formData, "profile_url"));
  if (!profile) return { error: "That doesn't look like a linkedin.com/in/... profile URL." };

  let requestedAt = new Date();
  if (sentOn) {
    const parsed = dateInputToDate(sentOn);
    if (!parsed) return { error: "The sent date must be today or earlier." };
    requestedAt = parsed;
  }

  const { error } = await authed.supabase.rpc("log_request", {
    p_full_name: fullName,
    p_profile_url: profile.url,
    p_profile_url_key: profile.key,
    p_role: role || null,
    p_company_name: company || null,
    p_company_category: categoryOrDefault(field(formData, "company_category")),
    p_requested_at: requestedAt.toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      const { data } = await authed.supabase.from("people").select("full_name").eq("profile_url_key", profile.key).maybeSingle();
      return { error: `Already logged${data?.full_name ? `: ${data.full_name}` : ""}.` };
    }
    return { error: error.message };
  }

  refresh();
  return { ok: true, message: `Logged ${fullName}.`, nonce: Date.now() };
}

export async function markAccepted(personId: string): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);
  if (!isUuid(personId)) return fail("Invalid person.");

  const { error } = await authed.supabase.rpc("mark_accepted", { p_person_id: personId });
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}

export async function markMessageSent(input: MarkSentInput): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);

  // Server actions receive untrusted input at runtime whatever the TypeScript signature says.
  const i = (input ?? {}) as Partial<MarkSentInput>;
  if (!isUuid(i.personId) || !isUuid(i.templateId)) return fail("Invalid person or template.");
  if (typeof i.templateVersion !== "number" || !Number.isInteger(i.templateVersion) || i.templateVersion < 1) {
    return fail("Invalid template version.");
  }
  if (typeof i.finalText !== "string" || i.finalText.trim() === "") return fail("The message is empty.");
  if (i.finalText.length > MAX_MESSAGE_TEXT) return fail("The message is too long.");

  const { error } = await authed.supabase.rpc("mark_message_sent", {
    p_person_id: i.personId,
    p_template_id: i.templateId,
    p_template_version: i.templateVersion,
    p_final_text: i.finalText,
    p_allow_duplicate: i.allowDuplicate === true,
  });

  if (error) {
    if (error.message.includes("already_messaged")) {
      return { ok: false, code: "already_messaged", error: "This person was already messaged." };
    }
    return fail(error.message);
  }
  refresh();
  return { ok: true };
}

/** Bound with the person id: updatePersonDetails.bind(null, id). */
export async function updatePersonDetails(personId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };
  if (!isUuid(personId)) return { error: "Invalid person." };

  const fullName = field(formData, "full_name");
  const role = field(formData, "role");
  const company = field(formData, "company");
  if (!fullName) return { error: "Name is required." };
  if ([fullName, role, company].some((v) => v.length > MAX_SHORT_TEXT)) return { error: "Name, role and company must be under 200 characters." };

  const { error: updateError } = await authed.supabase
    .from("people")
    .update({ full_name: fullName, role: role || null })
    .eq("id", personId);
  if (updateError) return { error: updateError.message };

  const { error: companyError } = await authed.supabase.rpc("set_person_company", {
    p_person_id: personId,
    p_company_name: company,
    p_company_category: categoryOrDefault(field(formData, "company_category")),
  });
  if (companyError) return { error: companyError.message };

  refresh();
  return { ok: true, message: "Saved.", nonce: Date.now() };
}

// ---------------------------------------------------------------- settings

export async function updateSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };

  const followUp = parseDaysInput(formData.get("follow_up_days"));
  const nudge = parseDaysInput(formData.get("pending_nudge_days"));
  if (followUp === null || nudge === null) return { error: "Days must be whole numbers from 1 to 365." };

  const { error } = await authed.supabase.from("settings").upsert(
    [
      { key: "follow_up_days", value: followUp },
      { key: "pending_nudge_days", value: nudge },
      { key: "show_photos", value: formData.get("show_photos") === "on" },
    ],
    { onConflict: "key" },
  );
  if (error) return { error: error.message };

  refresh();
  return { ok: true, message: "Settings saved.", nonce: Date.now() };
}

// ---------------------------------------------------------------- templates

/** Editing a template = inserting a new immutable version. The DB assigns the number. */
export async function saveTemplateVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };

  const templateId = field(formData, "template_id");
  const note = field(formData, "note");
  // Browsers submit textarea line breaks as CRLF; templates are stored with LF only.
  const rawBody = formData.get("body");
  const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n") : "";

  if (!isUuid(templateId)) return { error: "Invalid template." };
  if (body.trim() === "") return { error: "A template can't be empty." };
  if (body.length > MAX_MESSAGE_TEXT) return { error: "That template is too long." };

  const unknown = findUnknownPlaceholders(body);
  if (unknown.length > 0) {
    return { error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Only {{first_name}}, {{Company}} and {{COMPANY_UPPER}} are filled in, and saved versions can't be deleted.` };
  }

  const { data: current, error: currentError } = await authed.supabase
    .from("templates_current")
    .select("body")
    .eq("template_id", templateId)
    .maybeSingle();
  if (currentError) return { error: currentError.message };
  if (!current) return { error: "Template not found." };
  if (current.body === body) return { error: "No changes to save." };

  const { error } = await authed.supabase
    .from("template_versions")
    .insert({ template_id: templateId, body, note: note || null });
  if (error) return { error: error.message };

  refresh();
  return { ok: true, message: "Saved as a new version.", nonce: Date.now() };
}

// ---------------------------------------------------------------- unknown accepts

const mapAcceptError = (message: string): string => {
  if (message.includes("candidate_not_unmatched")) return "That accept was already handled. Reload the page.";
  if (message.includes("candidate_not_found")) return "That accept no longer exists.";
  if (message.includes("person_not_found")) return "That person no longer exists.";
  return message;
};

/** Bound with the candidate id: linkAccept.bind(null, id). The select posts `person_id`. */
export async function linkAccept(candidateId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };
  const personId = field(formData, "person_id");
  if (!isUuid(candidateId) || !isUuid(personId)) return { error: "Pick which request this is." };

  const { error } = await authed.supabase.rpc("link_accept", { p_candidate_id: candidateId, p_person_id: personId });
  if (error) return { error: mapAcceptError(error.message) };
  refresh();
  return { ok: true, message: "Linked.", nonce: Date.now() };
}

/** Bound with the candidate id. The company field is prefilled from the email's headline guess, never applied unseen. */
export async function createPersonFromAccept(candidateId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const authed = await getAuthedClient();
  if (!authed) return { error: SIGNED_OUT };
  if (!isUuid(candidateId)) return { error: "Invalid accept." };
  const company = field(formData, "company");
  if (company.length > MAX_SHORT_TEXT) return { error: "Company must be under 200 characters." };

  const { error } = await authed.supabase.rpc("create_person_from_accept", {
    p_candidate_id: candidateId,
    p_company_name: company || null,
    p_company_category: categoryOrDefault(field(formData, "company_category")),
  });
  if (error) return { error: mapAcceptError(error.message) };
  refresh();
  return { ok: true, message: "Added to Accepted.", nonce: Date.now() };
}

export async function dismissAccept(candidateId: string): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);
  if (!isUuid(candidateId)) return fail("Invalid accept.");
  const { error } = await authed.supabase.rpc("dismiss_accept", { p_candidate_id: candidateId });
  if (error) return fail(mapAcceptError(error.message));
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- replies, follow-ups, status

const mapPersonError = (message: string): string => {
  if (message.includes("not_awaiting_reply")) return "They're not waiting on a reply, so there's nothing to follow up.";
  if (message.includes("person_not_found")) return "That person no longer exists. Reload the page.";
  return message;
};

/** They replied: records the reply and moves them to "Replied" (unless they are already further along). */
export async function markReplied(personId: string): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);
  if (!isUuid(personId)) return fail("Invalid person.");
  const { error } = await authed.supabase.rpc("mark_replied", { p_person_id: personId });
  if (error) return fail(mapPersonError(error.message));
  refresh();
  return { ok: true };
}

/** You sent a follow-up (outside this app): restarts the no-reply clock. */
export async function markFollowedUp(personId: string): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);
  if (!isUuid(personId)) return fail("Invalid person.");
  const { error } = await authed.supabase.rpc("mark_followed_up", { p_person_id: personId });
  if (error) return fail(mapPersonError(error.message));
  refresh();
  return { ok: true };
}

export async function setPersonStatus(personId: string, status: string): Promise<ActionResult> {
  const authed = await getAuthedClient();
  if (!authed) return fail(SIGNED_OUT);
  if (!isUuid(personId)) return fail("Invalid person.");
  if (!isPersonStatus(status)) return fail("Unknown status.");
  const { error } = await authed.supabase.rpc("set_person_status", { p_person_id: personId, p_status: status });
  if (error) return fail(mapPersonError(error.message));
  refresh();
  return { ok: true };
}

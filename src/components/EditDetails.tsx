"use client";

import type { FormState } from "@/lib/action-types";
import type { CompanyRow, PersonRow } from "@/lib/db-types";
import { useFormAction } from "@/lib/use-form-action";
import { CompanyField } from "./CompanyField";

/** Fix a name, role or company. The company decides the default template and fills {{Company}}. */
export function EditDetails({
  person,
  company,
  companies,
  action,
}: {
  person: Pick<PersonRow, "id" | "full_name" | "role" | "company_name_raw">;
  company: CompanyRow | null;
  companies: readonly CompanyRow[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const { state, onSubmit, pending } = useFormAction(action);
  return (
    <details className="more">
      <summary>Edit details</summary>
      <form onSubmit={onSubmit} className="grid-form two">
        <div className="field">
          <label htmlFor={`name-${person.id}`}>Name</label>
          <input id={`name-${person.id}`} name="full_name" type="text" defaultValue={person.full_name} required maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor={`role-${person.id}`}>Role</label>
          <input id={`role-${person.id}`} name="role" type="text" defaultValue={person.role ?? ""} maxLength={200} />
        </div>
        <CompanyField companies={companies} defaultValue={company?.name ?? person.company_name_raw ?? ""} />
        <div className="span-2 row">
          <button type="submit" className="btn small" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {state.error && <span className="banner error" role="alert">{state.error}</span>}
          {state.ok && <span className="small muted" role="status">{state.message}</span>}
        </div>
      </form>
    </details>
  );
}

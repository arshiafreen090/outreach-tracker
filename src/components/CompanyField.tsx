"use client";

import { useId, useState } from "react";
import { CATEGORY_LABELS, COMPANY_CATEGORIES } from "@/lib/categories";
import type { CompanyRow } from "@/lib/db-types";

/**
 * Company name with suggestions. If the name isn't an existing company, a category
 * picker appears (the category chooses the default template) and the company is
 * created on save. Existing companies keep their category.
 */
export function CompanyField({
  companies,
  defaultValue = "",
}: {
  companies: readonly Pick<CompanyRow, "id" | "name" | "category">[];
  defaultValue?: string;
}) {
  const uid = useId();
  const [value, setValue] = useState(defaultValue);
  const typed = value.trim().toLowerCase();
  const match = typed ? companies.find((c) => c.name.trim().toLowerCase() === typed) : undefined;
  const isNew = typed !== "" && !match;

  return (
    <>
      <div className="field">
        <label htmlFor={`${uid}-company`}>Company</label>
        <input
          id={`${uid}-company`}
          name="company"
          type="text"
          list={`${uid}-list`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <datalist id={`${uid}-list`}>
          {companies.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        {match && <span className="small muted">Category: {CATEGORY_LABELS[match.category]}</span>}
      </div>
      {isNew && (
        <div className="field">
          <label htmlFor={`${uid}-category`}>Category for new company</label>
          <select id={`${uid}-category`} name="company_category" defaultValue="other_relevant">
            {COMPANY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <span className="small muted">Chooses the default template.</span>
        </div>
      )}
    </>
  );
}

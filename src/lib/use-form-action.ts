"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { FormState } from "@/lib/action-types";

/**
 * Runs a server action from a form's submit event. Unlike <form action={fn}>, React does
 * not auto-reset the fields afterwards, so a failed save keeps what you typed. Forms that
 * should clear on success re-key themselves on `state.nonce`.
 */
export function useFormAction(action: (prev: FormState, formData: FormData) => Promise<FormState>) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await action(state, formData));
    });
  }

  return { state, onSubmit, pending };
}

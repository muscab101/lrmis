"use client";

import type { ActionResult } from "@dhulka/core/errors";
import { Button } from "@dhulka/ui/button";
import { Field } from "@dhulka/ui/field";
import { Textarea } from "@dhulka/ui/input";
import { useState } from "react";
import { FormDialog } from "@/components/forms/form-dialog";

/** A button that asks for a note (optional or required) and runs an action with it. */
export function NoteAction({
  label,
  title,
  description,
  noteLabel,
  required = true,
  destructive = false,
  variant = "outline",
  success,
  submit,
}: {
  label: string;
  title: string;
  description?: string;
  noteLabel?: string;
  required?: boolean;
  destructive?: boolean;
  variant?: "default" | "outline" | "destructive" | "ghost";
  success: string;
  submit: (note: string) => Promise<ActionResult<unknown>>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setNote("");
        }}
        title={title}
        description={description}
        confirmLabel={label}
        destructive={destructive}
        successMessage={success}
        submit={() => submit(note)}
      >
        {noteLabel
          ? (fe) => (
              <Field id="note" label={noteLabel} error={fe("note")} required={required}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )
          : undefined}
      </FormDialog>
    </>
  );
}

import { useState } from "react";
import type { Need } from "../lib/types.js";

interface Props {
  needs: Need[];
  disabled: boolean;
  onSubmit: (text: string, answers: Record<string, string>) => void;
}

/** Say what an answer means, so the sentence cannot be misread. */
function phrase(id: Need["id"], value: string): string {
  switch (id) {
    case "from":
      return `from ${value}`;
    case "where":
      return `to ${value}`;
    case "days":
      // "3" needs the unit; "a week" already reads as a length.
      return /^\d+$/.test(value) ? `for ${value} days` : `for ${value}`;
    case "budget":
      return `on a budget of ${value}`;
  }
}

/**
 * Shown when a request was too vague to plan — a few plain questions instead of
 * a wall of prose.
 *
 * Every field is optional. Someone can answer "wherever is warm" and leave the
 * rest blank; the answers are joined into one ordinary sentence and re-parsed as
 * a normal turn, so nothing special happens downstream. Anything still missing is
 * assumed by the agents and disclosed rather than hidden.
 */
export function TripForm({ needs, disabled, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const filled = needs.filter((n) => answers[n.id]?.trim());

  function submit() {
    // The sentence is shown back as the request that was planned, so each answer
    // is phrased for what it means. Joining the raw values read as
    // "Plan a trip — Chandigarh, 3, 5k", where the only place name was the origin
    // and got taken for the destination.
    //
    // Every box blank is allowed, because the page offers it: that plans a trip
    // with nothing settled, which is the Destination Agent's whole job.
    const sentence = filled.length
      ? `Plan a trip ${filled.map((n) => phrase(n.id, answers[n.id]!.trim())).join(", ")}`
      : "Plan a trip";

    // Every field that was asked, including the blanks. A blank is an answer —
    // "you choose" — and omitting it would look like the question was never put.
    const byField = Object.fromEntries(
      needs.map((n) => [n.id, (answers[n.id] ?? "").trim()]),
    );

    onSubmit(sentence, byField);
  }

  return (
    <form
      className="tripform"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {needs.map((need) => (
        <label key={need.id} className="tripform__field">
          <span className="tripform__label">{need.label}</span>
          <input
            type="text"
            className="tripform__input"
            placeholder={need.hint}
            value={answers[need.id] ?? ""}
            disabled={disabled}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [need.id]: e.target.value }))
            }
          />
        </label>
      ))}

      <button type="submit" disabled={disabled}>
        {filled.length === 0 ? "Choose for me" : "Plan my trip"}
      </button>
    </form>
  );
}

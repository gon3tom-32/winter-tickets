"use client";

import SeatMap from "./SeatMap";
import type { MapSeat, Section, Tier } from "@/lib/types";
import type { Statuses } from "./useHolds";

export default function CompPicker(props: {
  action: (form: FormData) => void;
  night: { id: string; grades: string[] };
  seats: MapSeat[];
  sections: Section[];
  tiers: Tier[];
  statuses: Statuses;
}) {
  return (
    <SeatMap
      seats={props.seats}
      sections={props.sections}
      tiers={props.tiers}
      maxSeats={100}
      performanceId={props.night.id}
      holdsEnabled={false}
      holdMinutes={0}
      initial={{ statuses: props.statuses, mine: [], otherNights: 0, expiresAt: null }}
      staffActions={(ids) => (
        <form action={props.action} className="stack comp-form">
          <input type="hidden" name="night" value={props.night.id} />
          <input type="hidden" name="seats" value={ids.join(",")} />
          <label className="field">
            Who the tickets are for
            <input name="recipient" required maxLength={200} />
          </label>
          <fieldset className="grades">
            <legend>Grade supported (choose at least one)</legend>
            <div className="grade-options">
              {props.night.grades.map((g) => (
                <label key={g} className="grade-option">
                  <input type="checkbox" name="grades" value={g} />
                  {g}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            Reason
            <input name="reason" required maxLength={500} />
          </label>
          <button className="button wide">
            Comp {ids.length} {ids.length === 1 ? "seat" : "seats"}
          </button>
        </form>
      )}
    />
  );
}

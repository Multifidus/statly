import type { ValueLabel } from "@/contracts";

/**
 * A common answer-scale preset, one-click fill for the "Answer choices" step. `lengths` maps the
 * number of choices to labels in natural low-to-high order (e.g. "Strongly disagree" ... "Strongly
 * agree"); a preset only applies when its row count matches the number of choices present.
 */
export interface ChoicePreset {
  id: string;
  name: string;
  lengths: Record<number, string[]>;
}

export const CHOICE_PRESETS: ChoicePreset[] = [
  {
    id: "agreement",
    name: "Agreement",
    lengths: {
      3: ["Disagree", "Neither agree nor disagree", "Agree"],
      4: ["Strongly disagree", "Disagree", "Agree", "Strongly agree"],
      5: ["Strongly disagree", "Disagree", "Neither agree nor disagree", "Agree", "Strongly agree"],
      7: [
        "Strongly disagree",
        "Disagree",
        "Somewhat disagree",
        "Neither agree nor disagree",
        "Somewhat agree",
        "Agree",
        "Strongly agree",
      ],
    },
  },
  {
    id: "frequency",
    name: "Frequency",
    lengths: {
      3: ["Never", "Sometimes", "Always"],
      4: ["Never", "Rarely", "Often", "Always"],
      5: ["Never", "Rarely", "Sometimes", "Often", "Always"],
      7: ["Never", "Rarely", "Occasionally", "Sometimes", "Often", "Very often", "Always"],
    },
  },
  {
    id: "satisfaction",
    name: "Satisfaction",
    lengths: {
      3: ["Dissatisfied", "Neutral", "Satisfied"],
      5: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"],
      7: [
        "Very dissatisfied",
        "Dissatisfied",
        "Somewhat dissatisfied",
        "Neutral",
        "Somewhat satisfied",
        "Satisfied",
        "Very satisfied",
      ],
    },
  },
  {
    id: "likelihood",
    name: "Likelihood",
    lengths: {
      3: ["Unlikely", "Neutral", "Likely"],
      5: ["Very unlikely", "Unlikely", "Neutral", "Likely", "Very likely"],
      7: [
        "Very unlikely",
        "Unlikely",
        "Somewhat unlikely",
        "Neutral",
        "Somewhat likely",
        "Likely",
        "Very likely",
      ],
    },
  },
  {
    id: "importance",
    name: "Importance",
    lengths: {
      4: ["Not at all important", "Slightly important", "Important", "Very important"],
      5: ["Not at all important", "Slightly important", "Moderately important", "Important", "Extremely important"],
    },
  },
  {
    id: "quality",
    name: "Quality",
    lengths: {
      4: ["Poor", "Fair", "Good", "Excellent"],
      5: ["Poor", "Fair", "Good", "Very good", "Excellent"],
    },
  },
  {
    id: "yes_no",
    name: "Yes/No",
    lengths: {
      2: ["No", "Yes"],
    },
  },
  {
    id: "true_false",
    name: "True/False",
    lengths: {
      2: ["False", "True"],
    },
  },
  {
    id: "keep_numbers",
    name: "Keep the numbers",
    lengths: {},
  },
];

/** Presets that offer a variant matching this many choices ("Keep the numbers" always applies). */
export function presetsForCount(count: number): ChoicePreset[] {
  return CHOICE_PRESETS.filter((p) => p.id === "keep_numbers" || !!p.lengths[count]);
}

/**
 * Fill `labels` from a preset, matched by row count. Codes and row order are never changed, only
 * `label`. When the observed codes run high-to-low (descending), the preset's low-to-high options
 * are applied in reverse so each code keeps the meaning it actually has, without reordering rows.
 */
export function applyChoicePreset(labels: ValueLabel[], preset: ChoicePreset): ValueLabel[] {
  if (preset.id === "keep_numbers") return labels.map((l) => ({ ...l, label: String(l.value) }));
  const options = preset.lengths[labels.length];
  if (!options || options.length !== labels.length) return labels;
  const nums = labels.map((l) => Number(l.value));
  const numeric = nums.every((n) => !Number.isNaN(n));
  const descending = numeric && nums.length > 1 && nums[0] > nums[nums.length - 1];
  const ordered = descending ? [...options].reverse() : options;
  return labels.map((l, i) => ({ ...l, label: ordered[i] }));
}

/** True when every row's label is just its code restated (e.g. a numeric export with no text). */
export function labelsAreJustCodes(labels: ValueLabel[]): boolean {
  return labels.length > 0 && labels.every((l) => String(l.label) === String(l.value));
}

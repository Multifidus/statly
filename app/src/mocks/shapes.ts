/**
 * Synthetic stand-ins for the practice datasets in fixtures/practice (same columns, header
 * rows, encodings, row counts and planted gotchas; values are generated, not read). The
 * browser can't read files, so the mock engine keys shapes off the path's file name.
 *
 * Mock-only deviations (to exercise the stacking review): in three_groups followup.csv,
 * SC0 is exported as SC1 (same question text -> "possibly renamed") and an extra Q11
 * question exists only in that file (-> "unmatched").
 */
import type { CellValue, PiiKind, Scale, VariableSchema } from "@/contracts";

export interface ColSpec {
  name: string;
  /** Qualtrics row-2 question text. */
  text: string;
  var: Partial<VariableSchema>;
  /** Deterministic generator; `h(salt)` is a stable pseudo-random number in [0, 1). */
  gen: (r: number, h: (salt?: number) => number) => CellValue;
}

export interface FileShape {
  key: string;
  nRows: number;
  headerRows: 1 | 2 | 3;
  qualtrics: boolean;
  encoding: string | null;
  delimiter: string | null;
  format: "csv" | "xlsx";
  sheets: string[];
  cols: ColSpec[];
  multiselect: string[];
  scales: Scale[];
}

export const MOCK_ROOT = "/mock/fixtures";

/** Files offered by the mock file picker (paths are fake; shapes are keyed by name). */
export const MOCK_FILES: { path: string; group: string }[] = [
  { path: `${MOCK_ROOT}/messy_qualtrics/messy_3header.csv`, group: "Messy Qualtrics export" },
  { path: `${MOCK_ROOT}/messy_qualtrics/messy_2header.csv`, group: "Messy Qualtrics export" },
  { path: `${MOCK_ROOT}/messy_qualtrics/messy_utf16.csv`, group: "Messy Qualtrics export" },
  { path: `${MOCK_ROOT}/messy_qualtrics/messy_text_choices.csv`, group: "Messy Qualtrics export" },
  { path: `${MOCK_ROOT}/messy_qualtrics/messy.xlsx`, group: "Messy Qualtrics export" },
  { path: `${MOCK_ROOT}/one_group_prepost_likert/pre.csv`, group: "One group, pre/post" },
  { path: `${MOCK_ROOT}/one_group_prepost_likert/post.csv`, group: "One group, pre/post" },
  { path: `${MOCK_ROOT}/linked_id_prepost/pre.csv`, group: "Linked IDs, pre/post" },
  { path: `${MOCK_ROOT}/linked_id_prepost/post.csv`, group: "Linked IDs, pre/post" },
  { path: `${MOCK_ROOT}/three_groups_prepost_followup/pre.csv`, group: "Three groups, three times" },
  { path: `${MOCK_ROOT}/three_groups_prepost_followup/post.csv`, group: "Three groups, three times" },
  { path: `${MOCK_ROOT}/three_groups_prepost_followup/followup.csv`, group: "Three groups, three times" },
  { path: `/mock/perf/wide_5000x300.csv`, group: "Performance (5,000 rows x 300 columns)" },
];

export const MOCK_EXAMPLE_PROJECT_PATH = "/mock/projects/Example project.statly";

// ---------------------------------------------------------------------------------------

const pad = (n: number, w = 3) => String(n).padStart(w, "0");
const pick = <T,>(xs: readonly T[], u: number) => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))];
const iso = (r: number, offsetMin = 0) => {
  const d = new Date(Date.UTC(2026, 1, 20, 9, 0, 0) + (r * 37 + offsetMin) * 60_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
};

const LIKERT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] as const;
const numLabels = (codes: number[]) => codes.map((c) => ({ value: c, label: String(c) }));
const likertCoded = () => LIKERT.map((l, i) => ({ value: i + 1, label: l }));

function pii(kind: PiiKind, explanation: string): Partial<VariableSchema> {
  return { is_pii: true, is_metadata: true, pii_reason: { kind, explanation } };
}

const meta = (extra: Partial<VariableSchema> = {}): Partial<VariableSchema> => ({
  is_metadata: true,
  ...extra,
});

interface MetaOpts {
  status?: (r: number) => string;
  progress?: (r: number) => number;
  names?: (r: number) => [string, string, string] | null;
}

function metadataCols(tag: string, o: MetaOpts = {}): ColSpec[] {
  const progress = o.progress ?? (() => 100);
  return [
    { name: "StartDate", text: "Start Date", var: meta({ dtype: "datetime" }), gen: (r) => iso(r) },
    { name: "EndDate", text: "End Date", var: meta({ dtype: "datetime" }), gen: (r) => iso(r, 6) },
    { name: "Status", text: "Response Type", var: meta(), gen: (r) => (o.status ? o.status(r) : "IP Address") },
    {
      name: "IPAddress",
      text: "IP Address",
      var: pii("ip_address", "An IP address can point to a person's home or device."),
      gen: (r, h) => `10.${Math.floor(h(1) * 255)}.${r % 250}.${Math.floor(h(2) * 250)}`,
    },
    { name: "Progress", text: "Progress", var: meta({ dtype: "integer", level: "continuous" }), gen: (r) => progress(r) },
    {
      name: "Duration (in seconds)",
      text: "Duration (in seconds)",
      var: meta({ dtype: "integer", level: "continuous" }),
      gen: (_r, h) => 120 + Math.floor(h() * 600),
    },
    { name: "Finished", text: "Finished", var: meta({ dtype: "boolean" }), gen: (r) => progress(r) >= 100 },
    { name: "RecordedDate", text: "Recorded Date", var: meta({ dtype: "datetime" }), gen: (r) => iso(r, 6) },
    { name: "ResponseId", text: "Response ID", var: meta({ role: "identifier" }), gen: (r) => `R_${tag}_${pad(r, 5)}` },
    {
      name: "RecipientLastName",
      text: "Recipient Last Name",
      var: pii("name", "This column holds people's last names."),
      gen: (r) => (o.names ? (o.names(r)?.[1] ?? null) : null),
    },
    {
      name: "RecipientFirstName",
      text: "Recipient First Name",
      var: pii("name", "This column holds people's first names."),
      gen: (r) => (o.names ? (o.names(r)?.[0] ?? null) : null),
    },
    {
      name: "RecipientEmail",
      text: "Recipient Email",
      var: pii("email", "This column holds email addresses."),
      gen: (r) => (o.names ? (o.names(r)?.[2] ?? null) : null),
    },
    { name: "ExternalReference", text: "External Data Reference", var: meta(), gen: () => null },
    {
      name: "LocationLatitude",
      text: "Location Latitude",
      var: pii("location", "Map coordinates can show where someone lives or studies."),
      gen: (_r, h) => Math.round((40 + h(3)) * 10_000) / 10_000,
    },
    {
      name: "LocationLongitude",
      text: "Location Longitude",
      var: pii("location", "Map coordinates can show where someone lives or studies."),
      gen: (_r, h) => Math.round((-74 - h(4)) * 10_000) / 10_000,
    },
    { name: "DistributionChannel", text: "Distribution Channel", var: meta(), gen: () => "anonymous" },
    { name: "UserLanguage", text: "User Language", var: meta(), gen: () => "EN" },
  ];
}

// --- messy_qualtrics ---------------------------------------------------------------------

const PREVIEW_ROWS = new Set([5, 42, 79]);
const SPAM_ROWS = new Set([20, 60]);
const UNFINISHED: Record<number, number> = { 3: 24, 17: 51, 31: 8, 45: 73, 59: 26, 73: 89, 87: 32, 101: 51 };
const STRATEGIES = ["Textbook", "Online videos", "Study group", "Tutor", "Practice problems", "Office hours", "Flashcards", "Other"];
const Q6_CODES = [1, 2, 4, 5, 7];

function messy(variant: "3header" | "2header" | "utf16" | "text" | "xlsx"): FileShape {
  const text = variant === "text";
  const likertCol = (i: number): ColSpec => ({
    name: `Q5_${i}`,
    text: `Matrix statement ${i} about classroom experience${i === 4 ? " (reverse-worded)" : ""}`,
    // Mirrors the engine: text choices are proposed as integers coded 1..k (choice_text_detected);
    // numeric matrix items carry no value labels.
    var: text
      ? { role: "likert_item", level: "ordinal", dtype: "integer", missing_codes: [-99], scale_id: "scale_Q5",
          value_labels: likertCoded(), response_range: { min: 1, max: 5 } }
      : { role: "likert_item", level: "ordinal", dtype: "integer", missing_codes: [-99], scale_id: "scale_Q5",
          value_labels: [], response_range: { min: 1, max: 5 } },
    gen: (_r, h) => {
      if (h(9) < 0.028) return text ? "-99" : -99;
      const k = Math.min(4, Math.floor(h() * 5));
      return text ? LIKERT[k] : k + 1;
    },
  });
  const cols: ColSpec[] = [
    ...metadataCols("MQ", {
      status: (r) => (PREVIEW_ROWS.has(r) ? "Survey Preview" : SPAM_ROWS.has(r) ? "Spam" : "IP Address"),
      progress: (r) => UNFINISHED[r] ?? 100,
      names: (r) =>
        r === 11 || r === 88
          ? ["Jordan", "Reyes", "jordan.reyes@example.edu"]
          : [`First${r}`, `Last${r}`, `student${r}@example.edu`],
    }),
    { name: "Q1", text: "Do you consent to participate?", var: { level: "nominal" }, gen: () => "Yes" },
    ...["First Click", "Last Click", "Page Submit"].map<ColSpec>((t, i) => ({
      name: `Q1_${t}`,
      text: `Q1 - ${t}`,
      var: meta({ dtype: "float", level: "continuous" }),
      gen: (_r, h) => Math.round(h(20 + i) * 3000 + i * 1000) / 1000,
    })),
    { name: "Q1_Click Count", text: "Q1 - Click Count", var: meta({ dtype: "integer", level: "continuous" }), gen: (_r, h) => 1 + Math.floor(h() * 4) },
    ...[1, 2, 3, 4, 5, 6].map(likertCol),
    {
      name: "Q6",
      text: "How satisfied are you with the course overall?",
      var: text
        ? { level: "ordinal", dtype: "integer", missing_codes: [-99], value_labels: likertCoded(), response_range: { min: 1, max: 5 } }
        : { level: "ordinal", dtype: "integer", missing_codes: [-99], value_labels: numLabels(Q6_CODES), response_range: { min: 1, max: 7 } },
      gen: (_r, h) => {
        if (h(9) < 0.02) return text ? "-99" : -99;
        const k = Math.min(4, Math.floor(h() * 5));
        return text ? LIKERT[k] : Q6_CODES[k];
      },
    },
    {
      name: "Q7",
      text: "Which study strategies did you use? (select all that apply)",
      var: { level: "nominal", value_labels: STRATEGIES.map((o) => ({ value: o, label: o })) },
      gen: (_r, h) => {
        const n = 1 + Math.floor(h() * 3);
        const chosen = new Set<string>();
        for (let i = 0; i < n; i++) chosen.add(pick(STRATEGIES, h(30 + i)));
        return [...chosen].join(",");
      },
    },
    {
      name: "Q7_8_TEXT",
      text: "Which study strategies did you use? - Other, please specify",
      var: { role: "open_text", level: "nominal" },
      gen: (_r, h) => (h() < 0.15 ? pick(["Khan Academy", "Asked my sister", "Reddit threads"], h(2)) : null),
    },
    {
      name: "Q9",
      text: "Is there anything else you'd like to share? (open-ended)",
      var: { role: "open_text", level: "nominal" },
      gen: (_r, h) =>
        h() < 0.5 ? null : h(2) < 0.2 ? "You can reach me at jay (at) example dot edu" : "The labs were helpful.",
    },
    {
      name: "Q10",
      text: "Please describe your overall experience.",
      var: { role: "open_text", level: "nominal" },
      gen: (_r, h) => (h() < 0.3 ? null : 'It was "fine", mostly.\nThe pace was quick, but fair, I think.'),
    },
    {
      name: "SC0",
      text: "Total score",
      var: { role: "test_total", dtype: "integer", level: "continuous" },
      gen: (_r, h) => Math.floor(h() * 21),
    },
  ];
  return {
    key: `messy_${variant}`,
    nRows: 113,
    headerRows: variant === "2header" ? 2 : 3,
    qualtrics: true,
    encoding: variant === "3header" ? "utf-8-sig" : variant === "utf16" ? "utf-16" : variant === "xlsx" ? null : "utf-8",
    delimiter: variant === "utf16" ? "\t" : variant === "xlsx" ? null : ",",
    format: variant === "xlsx" ? "xlsx" : "csv",
    sheets: variant === "xlsx" ? ["Notes", "Data"] : [],
    cols,
    multiselect: ["Q7"],
    scales: [matrixScale("Q5", [1, 2, 3, 4, 5, 6])],
  };
}

function matrixScale(q: string, idx: number[]): Scale {
  return {
    id: `scale_${q}`,
    name: `${q} matrix`,
    items: idx.map((i) => `${q}_${i}`),
    scoring_method: "mean",
    min_items: null,
    score_variable: null,
    origin: "matrix_suggestion",
  };
}

const notesSheet: FileShape = {
  key: "messy_xlsx_notes",
  nRows: 4,
  headerRows: 1,
  qualtrics: false,
  encoding: null,
  delimiter: null,
  format: "xlsx",
  sheets: ["Notes", "Data"],
  cols: [
    {
      name: "Instructions",
      text: "Instructions",
      var: { role: "open_text" },
      gen: (r) => ["This workbook was exported from Qualtrics.", "The responses are on the Data sheet.", "Do not edit the header rows.", "Questions? Ask your instructor."][r],
    },
  ],
  multiselect: [],
  scales: [],
};

// --- one_group_prepost_likert ------------------------------------------------------------

function likertPrePost(which: "pre" | "post"): FileShape {
  const shift = which === "post" ? 0.1 : 0;
  return {
    key: `likert_${which}`,
    nRows: 60,
    headerRows: 3,
    qualtrics: true,
    encoding: "utf-8-sig",
    delimiter: ",",
    format: "csv",
    sheets: [],
    cols: [
      ...metadataCols(which === "pre" ? "L1" : "L2"),
      ...Array.from({ length: 10 }, (_, i): ColSpec => ({
        name: `Q3_${i + 1}`,
        text: `How much do you agree? - Statement ${i + 1}`,
        var: { role: "likert_item", level: "ordinal", dtype: "integer", value_labels: numLabels([1, 2, 3, 4, 5]), response_range: { min: 1, max: 5 } },
        gen: (_r, h) => Math.min(5, 1 + Math.floor((h() + shift) * 5)),
      })),
    ],
    multiselect: [],
    scales: [matrixScale("Q3", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
  };
}

// --- linked_id_prepost -------------------------------------------------------------------

function linkedPrePost(which: "pre" | "post"): FileShape {
  // pre: S001..S080. post: 75 returning (S001..S075, case/space-mangled), 4 late adds
  // (S081..S084), and retakes of S010 and S020 -> 81 rows, 79 unique IDs.
  const postIds = [
    ...Array.from({ length: 75 }, (_, i) => i + 1),
    81, 82, 83, 84, 10, 20,
  ];
  const id = (r: number) => {
    if (which === "pre") return `S${pad(r + 1)}`;
    const n = postIds[r];
    const raw = `S${pad(n)}`;
    return r % 3 === 0 ? ` ${raw.toLowerCase()}` : r % 5 === 0 ? `${raw}\t` : raw;
  };
  return {
    key: `linked_${which}`,
    nRows: which === "pre" ? 80 : 81,
    headerRows: 3,
    qualtrics: true,
    encoding: "utf-8-sig",
    delimiter: ",",
    format: "csv",
    sheets: [],
    cols: [
      ...metadataCols(which === "pre" ? "K1" : "K2"),
      { name: "Q1", text: "Please enter your student code (first 2 letters of your mom's name + birth day)", var: { role: "identifier", level: "nominal" }, gen: (r) => id(r) },
      {
        name: "Q4",
        text: "Score on the practice quiz (0-100)",
        var: { dtype: "float", level: "continuous" },
        gen: (_r, h) => Math.round((60 + (which === "post" ? 5 : 0) + (h() - 0.5) * 30) * 10) / 10,
      },
    ],
    multiselect: [],
    scales: [],
  };
}

// --- three_groups_prepost_followup -------------------------------------------------------

const GROUP_N = { pre: 135, post: 119, followup: 98 } as const;

function threeGroups(which: "pre" | "post" | "followup"): FileShape {
  const scoreName = which === "followup" ? "SC1" : "SC0";
  const cols: ColSpec[] = [
    ...metadataCols(which.slice(0, 2).toUpperCase()),
    {
      name: "Q2",
      text: "Which class section are you in?",
      var: { role: "group", level: "nominal" },
      gen: (r) => pick(["Control", "Intervention A", "Intervention B"], (r % 3) / 3),
    },
    ...Array.from({ length: 20 }, (_, i): ColSpec => ({
      name: `Q4_${i + 1}`,
      text: `Knowledge check - Question ${i + 1}`,
      var: { role: "test_item", level: "nominal" },
      gen: (_r, h) => pick(["A", "B", "C", "D"], h()),
    })),
    { name: scoreName, text: "Total score", var: { role: "test_total", dtype: "integer", level: "continuous" }, gen: (_r, h) => Math.floor(h() * 21) },
  ];
  if (which === "followup") {
    cols.push({
      name: "Q11",
      text: "Did you use what you learned since the course ended?",
      var: { level: "nominal" },
      gen: (_r, h) => (h() < 0.6 ? "Yes" : "No"),
    });
  }
  return {
    key: `three_${which}`,
    nRows: GROUP_N[which],
    headerRows: 3,
    qualtrics: true,
    encoding: "utf-8-sig",
    delimiter: ",",
    format: "csv",
    sheets: [],
    cols,
    multiselect: [],
    scales: [],
  };
}

// --- performance -------------------------------------------------------------------------

function wide(): FileShape {
  return {
    key: "wide",
    nRows: 5000,
    headerRows: 1,
    qualtrics: false,
    encoding: "utf-8",
    delimiter: ",",
    format: "csv",
    sheets: [],
    cols: Array.from({ length: 300 }, (_, i): ColSpec => ({
      name: `V${pad(i + 1)}`,
      text: `Variable ${i + 1}`,
      var: i % 3 === 0 ? { dtype: "string", level: "nominal" } : { dtype: "float", level: "continuous" },
      gen: (_r, h) => {
        if (h(7) < 0.02) return null;
        return i % 3 === 0 ? pick(["red", "green", "blue", "gold"], h()) : Math.round(h() * 10_000) / 100;
      },
    })),
    multiselect: [],
    scales: [],
  };
}

/** Pick the synthetic shape for a path (and optional XLSX sheet). */
export function shapeForPath(path: string, sheet: string | null): FileShape | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const dir = path.toLowerCase();
  if (name === "messy.xlsx") return sheet === "Data" ? messy("xlsx") : notesSheet;
  if (name === "messy_3header.csv") return messy("3header");
  if (name === "messy_2header.csv") return messy("2header");
  if (name === "messy_utf16.csv") return messy("utf16");
  if (name === "messy_text_choices.csv") return messy("text");
  if (name.startsWith("wide")) return wide();
  const time = name.includes("follow") ? "followup" : name.includes("post") ? "post" : name.includes("pre") ? "pre" : null;
  if (time && dir.includes("three_groups")) return threeGroups(time);
  if (time && time !== "followup" && dir.includes("linked")) return linkedPrePost(time);
  if (time && time !== "followup") return likertPrePost(time);
  return null;
}

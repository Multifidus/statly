export interface TourStep {
  /** The sidebar/nav item this step refers to, shown as a small label. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "Welcome",
    title: "Welcome to Statly",
    body: "Statly helps you pick the right statistical test and run it correctly. This quick tour covers the main steps.",
  },
  {
    target: "Import",
    title: "Import your data",
    body: "Start on the Import screen to bring in a spreadsheet or CSV file. Statly checks it for common problems as it loads.",
  },
  {
    target: "Variable Interview",
    title: "Tell Statly about your variables",
    body: "The Variable Interview asks what each column means. Statly uses your answers to recommend the right test later.",
  },
  {
    target: "Test Advisor",
    title: "Get a recommended test",
    body: "Answer a few questions in the Test Advisor. It walks through your research question and suggests a matching test.",
  },
  {
    target: "Results & Test Log",
    title: "Review your results",
    body: "Every analysis you run appears in Results, with plain-language explanations. The Test Log keeps a history you can revisit.",
  },
  {
    target: "Learn & Study Planner",
    title: "Learn as you go",
    body: "Visit Learn pages any time for explanations of statistical concepts, or use the Study Planner to build a study plan.",
  },
];

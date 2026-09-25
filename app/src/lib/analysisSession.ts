/** Forget advisor answers, the guided-analysis state and cached results (new/opened project). */
import { useAdvisor } from "@/stores/advisor";
import { useAnalysisFlow } from "@/stores/analysisFlow";
import { useResults } from "@/stores/results";

export function resetAnalysisSession(): void {
  useAdvisor.getState().reset();
  useAnalysisFlow.getState().reset();
  useResults.getState().clear();
}

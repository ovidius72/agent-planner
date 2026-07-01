import { getFeatures, getPhases, getActiveTasks } from "../../lib/api";

export async function loader() {
  const [features, phases, activeTasks] = await Promise.all([
    getFeatures(),
    getPhases(),
    getActiveTasks(),
  ]);
  return { features, phases, activeTasks };
}

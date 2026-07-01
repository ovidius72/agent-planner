import { getFeatures, getPhases } from "../../lib/api";

export async function loader() {
  const [features, phases] = await Promise.all([getFeatures(), getPhases()]);
  return { features, phases };
}

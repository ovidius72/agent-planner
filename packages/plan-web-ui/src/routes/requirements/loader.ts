import { getPhases, getRequirements } from "../../lib/api";

export async function loader() {
  const [requirements, phases] = await Promise.all([getRequirements(), getPhases()]);
  return { requirements, phases };
}

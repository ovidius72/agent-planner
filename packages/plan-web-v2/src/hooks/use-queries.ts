import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "../api";
import type { Feature, Phase } from "../types";

/* ── Project ────────────────────────────────────────────────────────── */
export function useProject() {
  return useQuery({ queryKey: ["project"], queryFn: api.getProject });
}

/* ── Features ───────────────────────────────────────────────────────── */
export function useFeatures() {
  return useQuery({ queryKey: ["features"], queryFn: api.getFeatures });
}

export function useFeature(id: string) {
  return useQuery({
    queryKey: ["feature", id],
    queryFn: () => api.getFeature(id),
    enabled: !!id,
  });
}

export function useCreateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) => api.createFeature(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

export function useUpdateFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feature: Feature) => api.updateFeature(feature),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["features"] });
      qc.invalidateQueries({ queryKey: ["feature"] });
    },
  });
}

export function useDeleteFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteFeature(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features"] }),
  });
}

/* ── Phases ─────────────────────────────────────────────────────────── */
export function usePhases(featureId?: string) {
  return useQuery({
    queryKey: ["phases", featureId],
    queryFn: () => api.getPhases(featureId),
  });
}

export function usePhase(id: string) {
  return useQuery({
    queryKey: ["phase", id],
    queryFn: () => api.getPhase(id),
    enabled: !!id,
  });
}

export function useCreatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; featureId?: string }) => api.createPhase(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["phases"] }),
  });
}

export function useUpdatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phase: Phase) => api.updatePhase(phase),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phases"] });
      qc.invalidateQueries({ queryKey: ["phase"] });
    },
  });
}

export function useDeletePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePhase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["phases"] }),
  });
}

/* ── Tasks ──────────────────────────────────────────────────────────── */
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phaseId, ...data }: { phaseId: string; title: string; description?: string }) =>
      api.createTask(phaseId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phases"] });
      qc.invalidateQueries({ queryKey: ["phase"] });
    },
  });
}

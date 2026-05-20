/**
 * GenerationContext — survives modal close.
 *
 * The CreatePostDesignButton and CreatePostVideoButton modals are transient:
 * close them and their local state vanishes. But the underlying generations
 * (Gemini / Veo calls) continue in the background, and the user has no
 * indication that anything is still happening. They also can't see the result
 * when they reopen because the modal starts fresh.
 *
 * This context lifts generation state to the page level so:
 *  - Cards can show a "Generating…" overlay while their post's generation runs
 *  - A floating progress card surfaces in-flight work at the bottom-right
 *  - Completion toasts can link back to the right post (via openPanel callback)
 *  - Modal reopens see what already finished
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type GenerationType = "design" | "video";

/** Stable key for a post: platform + first 200 chars of copy. Same heuristic
 *  used elsewhere in the calendar to match iterations to posts. */
export function postKeyOf(post: {
  platform?: string | null;
  copy?: string | null;
  caption_angle?: string | null;
}): string {
  const platform = (post.platform || "").toLowerCase();
  const copy = (post.copy || post.caption_angle || "").trim().slice(0, 200);
  return `${platform}::${copy}`;
}

/** Short human-readable label for the floating progress card + toasts. */
export function postLabelOf(post: {
  platform?: string | null;
  copy?: string | null;
  caption_angle?: string | null;
  posting_time?: string | null;
}): string {
  const copy = (post.copy || post.caption_angle || "").trim();
  const head = copy.slice(0, 60);
  return head.length === copy.length ? head : `${head}…`;
}

export interface GenerationEntry {
  postKey: string;
  postLabel: string;
  type: GenerationType;
  total: number;
  completed: number;
  failed: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  completedAt?: number;
  /** The post object so the floating card / completion toast can open the panel. */
  post: any;
  /** The variant_group_id we just created. Passed back to openPanel so the
   *  panel can filter iterations by group_id directly — bypassing the
   *  platform+copy match heuristic that can mis-fire when copy is edited or
   *  realtime hasn't caught up yet. */
  variantGroupId?: string;
}

interface ContextValue {
  generations: Record<string, GenerationEntry>;
  startGeneration: (args: {
    post: any;
    type: GenerationType;
    total: number;
    variantGroupId?: string;
    /** Callback the owner of the generation registers so external surfaces
     *  (floating progress card, etc.) can request cancellation. The owner
     *  is responsible for actually stopping its loop — typically by
     *  flipping a ref the loop checks at each iteration. */
    onCancel?: () => void;
  }) => string;
  progressGeneration: (postKey: string, opts?: { failed?: boolean }) => void;
  completeGeneration: (postKey: string) => void;
  /** Request cancellation of a running generation. Calls the registered
   *  onCancel handler (if any) and marks the entry as cancelled. */
  cancelGeneration: (postKey: string) => void;
  dismissGeneration: (postKey: string) => void;
  /** Optional handler so the floating progress / completion toast can open the
   *  panel for a given post. Provided by ContentIdeasTab. The optional
   *  variantGroupId lets the panel filter to the exact set of rows we just
   *  produced (no copy-slice heuristic). */
  openPanel: (post: any, opts?: { variantGroupId?: string }) => void;
}

const GenerationContext = createContext<ContextValue | null>(null);

export function GenerationProvider({
  children,
  onOpenPanel,
}: {
  children: React.ReactNode;
  onOpenPanel: (post: any, opts?: { variantGroupId?: string }) => void;
}) {
  const [generations, setGenerations] = useState<Record<string, GenerationEntry>>({});
  const onOpenPanelRef = useRef(onOpenPanel);
  onOpenPanelRef.current = onOpenPanel;
  // Cancellation callbacks live outside React state. State holds only the
  // serializable parts of the entry; the function reference would otherwise
  // bloat re-render diffs and force consumers to re-render unnecessarily.
  const cancelHandlersRef = useRef<Record<string, () => void>>({});

  const startGeneration = useCallback(
    ({
      post,
      type,
      total,
      variantGroupId,
      onCancel,
    }: {
      post: any;
      type: GenerationType;
      total: number;
      variantGroupId?: string;
      onCancel?: () => void;
    }) => {
      const key = postKeyOf(post);
      const label = postLabelOf(post);
      if (onCancel) cancelHandlersRef.current[key] = onCancel;
      else delete cancelHandlersRef.current[key];
      setGenerations((prev) => ({
        ...prev,
        [key]: {
          postKey: key,
          postLabel: label,
          type,
          total,
          completed: 0,
          failed: 0,
          status: "running",
          startedAt: Date.now(),
          post,
          variantGroupId,
        },
      }));
      return key;
    },
    [],
  );

  const progressGeneration = useCallback(
    (postKey: string, opts?: { failed?: boolean }) => {
      setGenerations((prev) => {
        const entry = prev[postKey];
        if (!entry) return prev;
        return {
          ...prev,
          [postKey]: {
            ...entry,
            completed: entry.completed + 1,
            failed: opts?.failed ? entry.failed + 1 : entry.failed,
          },
        };
      });
    },
    [],
  );

  const completeGeneration = useCallback((postKey: string) => {
    setGenerations((prev) => {
      const entry = prev[postKey];
      if (!entry) return prev;
      // Don't downgrade an already-cancelled entry back to completed/failed
      // — the owner's loop may call completeGeneration in its finally block
      // AFTER the user already cancelled.
      if (entry.status === "cancelled") return prev;
      return {
        ...prev,
        [postKey]: {
          ...entry,
          status: entry.failed >= entry.total ? "failed" : "completed",
          completedAt: Date.now(),
        },
      };
    });
    delete cancelHandlersRef.current[postKey];
  }, []);

  const cancelGeneration = useCallback((postKey: string) => {
    // Invoke the registered handler so the owner's loop stops firing more
    // requests. We do this BEFORE updating state so the loop sees a state
    // transition consistent with our cancel before its next check.
    const handler = cancelHandlersRef.current[postKey];
    if (handler) {
      try {
        handler();
      } catch (e) {
        console.warn("[GenerationContext] cancel handler threw:", e);
      }
    }
    setGenerations((prev) => {
      const entry = prev[postKey];
      if (!entry || entry.status !== "running") return prev;
      return {
        ...prev,
        [postKey]: {
          ...entry,
          status: "cancelled",
          completedAt: Date.now(),
        },
      };
    });
    delete cancelHandlersRef.current[postKey];
  }, []);

  const dismissGeneration = useCallback((postKey: string) => {
    setGenerations((prev) => {
      const next = { ...prev };
      delete next[postKey];
      return next;
    });
    delete cancelHandlersRef.current[postKey];
  }, []);

  const openPanel = useCallback((post: any, opts?: { variantGroupId?: string }) => {
    onOpenPanelRef.current(post, opts);
  }, []);

  const value = useMemo<ContextValue>(
    () => ({
      generations,
      startGeneration,
      progressGeneration,
      completeGeneration,
      cancelGeneration,
      dismissGeneration,
      openPanel,
    }),
    [
      generations,
      startGeneration,
      progressGeneration,
      completeGeneration,
      cancelGeneration,
      dismissGeneration,
      openPanel,
    ],
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

export function useGenerationContext(): ContextValue {
  const ctx = useContext(GenerationContext);
  if (!ctx) {
    // Allow components outside the provider (e.g., AdHoc flow) to call no-ops.
    return {
      generations: {},
      startGeneration: () => "",
      progressGeneration: () => {},
      completeGeneration: () => {},
      cancelGeneration: () => {},
      dismissGeneration: () => {},
      openPanel: () => {},
    };
  }
  return ctx;
}

/** Look up the generation for a specific post (or undefined if none active). */
export function useGenerationForPost(post: {
  platform?: string | null;
  copy?: string | null;
  caption_angle?: string | null;
} | null | undefined): GenerationEntry | undefined {
  const { generations } = useGenerationContext();
  if (!post) return undefined;
  return generations[postKeyOf(post)];
}

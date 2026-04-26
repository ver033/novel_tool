import { z } from "zod";

export const modelRoleSchema = z.enum(["pro", "flash"]);
export const reasoningEffortSchema = z.enum(["high", "max"]);
export const thinkingModeSchema = z.enum(["enabled", "disabled"]);

export const taskModelSettingSchema = z.object({
  modelRole: modelRoleSchema,
  modelNameOverride: z.string().trim().min(1).optional(),
  reasoningEffort: reasoningEffortSchema,
  thinkingMode: thinkingModeSchema
});

export const taskModelProfileSchema = z.object({
  chat: taskModelSettingSchema,
  polish: taskModelSettingSchema,
  continuity: taskModelSettingSchema,
  expand: taskModelSettingSchema,
  proofread: taskModelSettingSchema,
  memory: taskModelSettingSchema
});

export const projectConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectName: z.string().min(1),
    language: z.literal("zh-CN"),
    defaultOpenState: z
      .object({
        chapterId: z.string().optional(),
        paragraphId: z.string().optional(),
        workspacePage: z.string().optional()
      })
      .default({}),
    taskModelProfile: taskModelProfileSchema,
    customInstructions: z.object({
      global: z.string(),
      polish: z.string(),
      expand: z.string(),
      proofread: z.string(),
      continuity: z.string(),
      chat: z.string()
    }),
    agentDefaults: z.object({
      chatExecutionMode: z.literal("suggest_only"),
      requireApprovalForWrites: z.literal(true),
      showToolTrace: z.boolean(),
      allowedTools: z.array(z.string())
    }),
    contextReferences: z
      .object({
        paragraphIds: z.array(z.string().min(1)).default([])
      })
      .default({ paragraphIds: [] })
  })
  .strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

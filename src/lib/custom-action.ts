import { z } from "zod";
import { actionPlanSchema, gameplaySchema } from "./manifest";
export const customActionSchema=z.object({
  key:z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  label:z.string().trim().min(1).max(80),
  plan:actionPlanSchema,
  gameplay:gameplaySchema,
});
export type CustomAction=z.infer<typeof customActionSchema>;

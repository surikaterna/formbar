import type { ProductionRule, RuleSession, ThenOperatorHandler, ThenOperatorRegistry } from "@arbitre/core";
import type { ArbiterPluginOptions, RegisteredExpressionThenOperator } from "@formbar/arbiter";
import type { registerExpressionThenOperator } from "@formbar/arbiter";

declare const rule: ProductionRule;
declare const session: RuleSession;
declare const handler: ThenOperatorHandler;
declare const registry: ThenOperatorRegistry;

export const rules: NonNullable<ArbiterPluginOptions["rules"]> = [rule];
export const configuredSession: ArbiterPluginOptions["session"] = session;
export const registered: RegisteredExpressionThenOperator["handler"] = handler;
export const registration: Parameters<typeof registerExpressionThenOperator>[0] = registry;

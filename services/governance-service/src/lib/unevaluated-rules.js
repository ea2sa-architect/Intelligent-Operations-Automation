// Rule types the catalog offers but nothing evaluates: they need runtime or
// content data that static evaluation does not have. rule-evaluator.js builds
// its SKIP entries from this list, so it is the single source of truth.
//
// A policy holding one of these can be Active/Enforce and still protect
// nothing for that rule, so policy reads, activation, and policy bundle
// import all surface it.
export const UNEVALUATED_RULE_TYPES = ['prompt_inspection', 'logging_restriction', 'execution_rate'];

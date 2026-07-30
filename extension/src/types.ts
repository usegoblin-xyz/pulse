// Mirrors server/src/types.ts. Kept as its own copy on purpose: this code ships
// in a public browser bundle and must not import from the key-holding server.

export interface FormField {
  id: string;
  name?: string;
  label?: string;
  type: string;
  autocomplete?: string;
  options?: string[];
  required?: boolean;
  sensitive?: boolean;
}

export type Profile = Record<string, string>;

export interface FillItem {
  fieldId: string;
  value: string;
}

export interface AskItem {
  fieldId: string;
  prompt: string;
}

export interface FillPlan {
  fills: FillItem[];
  asks: AskItem[];
}

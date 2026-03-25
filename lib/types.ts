export type FieldType = "text" | "email" | "textarea" | "select" | "radio" | "number" | "tel" | "checkbox";

export interface ShowWhenRule {
  fieldId: string;
  values: string[];
}

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  width: "half" | "full";
  placeholder: string;
  autocomplete: string;
  defaultValue: string;
  options?: string[];
  showWhen?: ShowWhenRule;
}

export interface BrandingConfig {
  eyebrow: string;
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
}

export interface IntegrationConfig {
  googleSheetsWebhookUrl: string;
  googleSheetsSecret: string;
  googleFormEnabled: boolean;
  googleFormActionUrl: string;
  googleFormFieldMap: Record<string, string>;
}

export interface Settings {
  branding: BrandingConfig;
  fields: FormField[];
  integrations: IntegrationConfig;
}

export interface SubmissionIntegrationStatus {
  enabled: boolean;
  ok: boolean | null;
  message: string;
}

export interface SubmissionRecord {
  id: string;
  submittedAt: string;
  values: Record<string, string>;
  meta: {
    ip: string;
    userAgent: string;
  };
  integrations: {
    googleSheets: SubmissionIntegrationStatus;
    googleForm: SubmissionIntegrationStatus;
  };
  warnings: string[];
}

export interface FormConfig {
  branding: BrandingConfig;
  fields: FormField[];
}

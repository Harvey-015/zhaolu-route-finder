export const LEGAL_DOCUMENT_VERSION = "2026-08-01" as const;

export type LegalDocumentConfig = Readonly<{
  operatorName: string;
  privacyContact: string;
  logRetentionDays: number;
}>;

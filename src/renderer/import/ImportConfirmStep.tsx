import { CheckCircle } from "@phosphor-icons/react";
import type { ImportConfirmResult, ImportPreview } from "../../main/shared/types";
import { ImportSummary } from "./ImportPreviewStep";
import { useI18n } from "../i18n";

type ImportConfirmStepProps = {
  readonly result: ImportConfirmResult | null;
  readonly preview: ImportPreview | null;
};

export function ImportConfirmStep({ result, preview }: ImportConfirmStepProps) {
  const { t } = useI18n();
  return (
    <>
      {preview ? <ImportSummary preview={preview} /> : null}
      <div className="success-state">
        <div>
          <span className="success-mark">
            <CheckCircle size={26} weight="bold" />
          </span>
          <h2 className="section-title">{t("importComplete")}</h2>
          <p className="muted">
            {result ? t("importResult", { name: result.project.name, count: result.chapters.length }) : t("importPendingResult")}
          </p>
        </div>
      </div>
    </>
  );
}

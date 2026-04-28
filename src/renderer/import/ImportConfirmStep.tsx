import { CheckCircle } from "@phosphor-icons/react";
import type { ImportConfirmResult, ImportPreview } from "../../main/shared/types";
import { ImportSummary } from "./ImportPreviewStep";

type ImportConfirmStepProps = {
  readonly result: ImportConfirmResult | null;
  readonly preview: ImportPreview | null;
};

export function ImportConfirmStep({ result, preview }: ImportConfirmStepProps) {
  return (
    <>
      {preview ? <ImportSummary preview={preview} /> : null}
      <div className="success-state">
        <div>
          <span className="success-mark">
            <CheckCircle size={26} weight="bold" />
          </span>
          <h2 className="section-title">导入完成</h2>
          <p className="muted">
            {result ? `已导入到《${result.project.name}》，共 ${result.chapters.length} 个章节。` : "确认导入后会在这里显示结果。"}
          </p>
        </div>
      </div>
    </>
  );
}

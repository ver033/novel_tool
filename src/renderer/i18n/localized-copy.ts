import type { AppLocale } from "../../main/shared/language";
import { useI18n } from "./index";

export type LocalizedCopy<T> = Readonly<Record<AppLocale, T>>;

export function resolveLocalizedCopy<TCopy extends Readonly<Record<AppLocale, unknown>>>(
  locale: AppLocale,
  copy: TCopy
): TCopy[AppLocale] {
  return copy[locale];
}

export function useLocalizedCopy<TCopy extends Readonly<Record<AppLocale, unknown>>>(copy: TCopy): TCopy[AppLocale] {
  const { locale } = useI18n();
  return resolveLocalizedCopy(locale, copy);
}

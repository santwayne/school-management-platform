// WhatsApp templates are approved per language. A school's WhatsApp Business
// Account may have a template approved only in English while the parent's
// preferred language is Hindi or Punjabi — Meta then rejects the send with
// error 132001 ("template name does not exist in the translation") and the
// parent gets nothing. These helpers pick the parent's language first and
// fall back to English, so a message is delivered either way and starts
// going out in Hindi/Punjabi automatically once that translation is approved.

export const FALLBACK_TEMPLATE_LANGUAGE = 'en';
const PARENT_LANGUAGES = ['hi', 'pa', 'en'];

// parents.preferred_language is 'hi' | 'pa' | 'en' (default 'hi').
export function parentTemplateLanguage(preferred) {
  return PARENT_LANGUAGES.includes(preferred) ? preferred : 'hi';
}

export function isTemplateLanguageMissing(err) {
  return err?.response?.data?.error?.code === 132001;
}

// sendInLanguage: (languageCode) => Promise<result>
// Returns { result, language } — language is the one that actually went out.
export async function sendWithLanguageFallback(sendInLanguage, language) {
  try {
    return { result: await sendInLanguage(language), language };
  } catch (err) {
    if (language === FALLBACK_TEMPLATE_LANGUAGE || !isTemplateLanguageMissing(err)) throw err;
    return { result: await sendInLanguage(FALLBACK_TEMPLATE_LANGUAGE), language: FALLBACK_TEMPLATE_LANGUAGE };
  }
}

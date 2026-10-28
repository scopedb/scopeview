/** Safe inside HTML script data, including hostile labels and closing script tags. */
export function serializeDocument(value) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

// On iOS, Futura-Medium and Futura-Bold are Apple system fonts pre-installed in the OS.
// Apple requires apps not to bundle duplicate .ttf copies of system-provided fonts (ITMS-91198).
// By exporting an empty map on iOS, Metro will not bundle the font files into the iOS app.
export const platformCustomFonts: Record<string, any> = {};

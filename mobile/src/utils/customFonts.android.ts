// On Android, Futura is not pre-installed, so we bundle and load the TTF font assets.
export const platformCustomFonts: Record<string, any> = {
  'Futura-Medium': require('../../assets/fonts/Futura-Medium.ttf'),
  'Futura-Bold': require('../../assets/fonts/Futura-Bold.ttf'),
};

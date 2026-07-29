import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  Pressable,
  Dimensions,
  Animated,
  Linking,
  Modal,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const SCREEN = Dimensions.get('screen');
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as AppleAuthentication from 'expo-apple-authentication';

const AnimatedExpoImage = Animated.createAnimatedComponent(ExpoImage);
import { WebView } from 'react-native-webview';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { FONT_FUTURA, FONT_FUTURA_BOLD } from '../../constants/fonts';
import PhoneView from './PhoneView';
import CameraViewScreen from './CameraView';

// Web & iOS Client IDs from Google Cloud Console
const GOOGLE_WEB_CLIENT_ID = '1051090030242-du725l33veu6vl637lo1jpgpka1ilujj.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '813548862884-m06a6t1mbo7v71qipthtao91bg105lqt.apps.googleusercontent.com';

// Safe dynamic imports for Google Sign-In to prevent crashes in Expo Go
let NativeGoogleSignin: any = null;
let isGoogleNativeAvailable = false;

try {
  const GoogleModule = require('@react-native-google-signin/google-signin');
  NativeGoogleSignin = GoogleModule.GoogleSignin;
  isGoogleNativeAvailable = !!NativeGoogleSignin;
} catch (e) {
  console.warn('Google Sign-In native module not available.');
}

interface LoginViewProps {
  onSuccess: () => void;
  startAnimation?: boolean;
}

export default function LoginView({ onSuccess, startAnimation = true }: LoginViewProps) {
  const profile = useAuthStore((state) => state.profile);
  const token = useAuthStore((state) => state.token);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [webModal, setWebModal] = useState<{ url: string; title: string } | null>(null);

  // Onboarding step after auth: login → phone (if missing) → selfie (if missing) → done
  const [step, setStep] = useState<'login' | 'phone' | 'selfie'>(() => {
    if (token && profile) {
      if (!profile.phoneNumber) return 'phone';
      if (!profile.hasSelfie) return 'selfie';
    }
    return 'login';
  });

  const signInWithFacebook = () => {
    Alert.alert(
      'Facebook Sign-In',
      'Facebook Sign-In is coming soon! Please sign in with Google in the meantime.',
      [{ text: 'OK', style: 'default' }]
    );
  };

  const openTerms = () => {
    setWebModal({
      url: 'https://mycircle.mistyvisuals.com/terms',
      title: 'Terms & Conditions',
    });
  };

  const openPrivacy = () => {
    setWebModal({
      url: 'https://mycircle.mistyvisuals.com/privacy',
      title: 'Privacy Policy',
    });
  };

  // Splash-to-login animation sequence on mount
  const logoPosAnim = useRef(new Animated.Value(0)).current; // 0 = centered, 1 = top bar
  const logoFadeAnim = useRef(new Animated.Value(1)).current; // Visible immediately to transition smoothly from native splash
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const googleAnim = useRef(new Animated.Value(0)).current;
  const appleAnim = useRef(new Animated.Value(0)).current;
  const termsAnim = useRef(new Animated.Value(0)).current;

  // Interpolate logo movement from center down to top header
  const logoTranslateY = logoPosAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN.height * 0.32, 0],
  });

  const logoScale = logoPosAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.2, 1],
  });

  // Dark overlay gradient opacity: soft during splash center, deepens as logo slides up to header
  const gradientOpacity = logoPosAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1.0],
  });

  const bgScale = logoPosAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1.06, 1.0],
  });

  const googleSlide = googleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  const appleSlide = appleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [35, 0],
  });

  const termsSlide = termsAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  useEffect(() => {
    if (!startAnimation) return;

    // 1. Slide logo UP to top header once native splash screen is dismissed
    Animated.timing(logoPosAnim, {
      toValue: 1,
      duration: 750,
      useNativeDriver: true,
    }).start(() => {
      // 2. Reveal center text and staggered bottom controls
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 650,
        useNativeDriver: true,
      }).start();

      Animated.stagger(140, [
        Animated.timing(googleAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(appleAnim, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(termsAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [startAnimation]);

  const setAuth = useAuthStore((state) => state.setAuth);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const passcode = useAuthStore((state) => state.passcode);

  useEffect(() => {
    if (isGoogleNativeAvailable && NativeGoogleSignin) {
      try {
        NativeGoogleSignin.configure({
          webClientId: GOOGLE_WEB_CLIENT_ID,
          iosClientId: GOOGLE_IOS_CLIENT_ID,
          offlineAccess: true,
        });
      } catch (e) {
        console.warn('GoogleSignin configure error:', e);
      }
    }
  }, []);

  const handleAuthSuccess = async (
    oauthToken: string,
    provider: 'google' | 'apple',
    extraFields?: { name?: string; email?: string }
  ) => {
    try {
      setIsLoggingIn(true);

      const hasValidEventSlug = Boolean(eventSlug && eventSlug !== 'null' && eventSlug !== 'undefined');
      const authUrl = hasValidEventSlug
        ? `/api/gallery/public/events/${eventSlug}/auth`
        : `/api/gallery/family/auth`;

      const payload = {
        token: oauthToken,
        provider: provider,
        code: passcode || undefined,
        ...extraFields,
      };

      const res = await api.post(authUrl, payload);
      const { token, profile } = res.data;

      // Pre-fetch joined events & selfie before updating auth state to prevent post-mount layout shift
      let userEvents: any[] = [];
      try {
        const eventsRes = await api.get('/api/gallery/family/events', {
          headers: { Authorization: `Bearer ${token}` }
        });
        userEvents = eventsRes.data?.events || [];
        if (eventsRes.data?.profile || eventsRes.data?.selfieUrl) {
          const selfieUrl = eventsRes.data.selfieUrl
            ? (eventsRes.data.selfieUrl.startsWith('http') ? eventsRes.data.selfieUrl : `https://mycircle.mistyvisuals.com${eventsRes.data.selfieUrl}`)
            : null;
          profile.selfieUrl = selfieUrl;
        }
      } catch (e) {
        // Non-critical background fetch failure
      }

      await setAuth(token, profile, userEvents);

      // Enforce mandatory onboarding steps before entering the app
      if (!profile.phoneNumber) {
        setStep('phone');
      } else if (!profile.hasSelfie) {
        setStep('selfie');
      } else {
        onSuccess();
      }
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Authentication with server failed. Please try again.';
      Alert.alert('Server Authentication Error', msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Called by PhoneView after phone number is saved
  const handlePhoneComplete = () => {
    const profile = useAuthStore.getState().profile;
    if (!profile?.hasSelfie) {
      setStep('selfie');
    } else {
      onSuccess();
    }
  };

  // Called by CameraViewScreen after selfie is verified
  const handleSelfieComplete = () => {
    onSuccess();
  };

  // 1. Google Sign-In
  const signInWithGoogle = async () => {
    try {
      setIsLoggingIn(true);
      if (!isGoogleNativeAvailable || !NativeGoogleSignin) {
        throw new Error('Native Google Sign-In not available in current environment');
      }

      await NativeGoogleSignin.hasPlayServices();
      const userInfo = await NativeGoogleSignin.signIn();

      // Handle new Google Sign-In v13+ API cancellation
      if (userInfo && userInfo.type === 'cancelled') {
        setIsLoggingIn(false);
        return;
      }

      let idToken = userInfo.data?.idToken || userInfo.idToken || (userInfo as any)?.idToken;

      if (!idToken && typeof NativeGoogleSignin.getTokens === 'function') {
        try {
          const tokens = await NativeGoogleSignin.getTokens();
          idToken = tokens?.idToken || tokens?.accessToken;
        } catch (_tokenErr) {}
      }

      if (!idToken) {
        idToken = userInfo.data?.serverAuthCode || userInfo.serverAuthCode || (userInfo as any)?.serverAuthCode;
      }

      const userEmail = userInfo.data?.user?.email || userInfo.user?.email || (userInfo as any)?.user?.email;

      if (idToken) {
        await handleAuthSuccess(idToken, 'google', { email: userEmail });
      } else if (userEmail) {
        await handleAuthSuccess(`google_auth_${userEmail}`, 'google', { email: userEmail, name: userInfo.data?.user?.name || userInfo.user?.name });
      } else {
        throw new Error('Google Sign-In completed but no ID Token was provided by Google.');
      }
    } catch (error: any) {
      console.error('Google Sign-In error', error);
      const isCancel = error.code === 'SIGN_IN_CANCELLED' || error.code === '12501';
      if (!isCancel) {
        Alert.alert('Google Sign-In Error', error.message || 'Google authentication failed. Please try again.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 2. Apple Sign-In
  const signInWithApple = async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Apple Sign-In', 'Apple Sign-In is supported on iOS devices. Please sign in with Google on Android.');
      return;
    }
    try {
      setIsLoggingIn(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential.identityToken) {
        const name = credential.fullName?.givenName
          ? `${credential.fullName.givenName} ${credential.fullName.familyName || ''}`.trim()
          : 'Apple User';
        await handleAuthSuccess(credential.identityToken, 'apple', {
          email: credential.email || undefined,
          name,
        });
      } else {
        throw new Error('Apple Sign-In failed to return an Identity Token');
      }
    } catch (error: any) {
      console.error('Apple Sign-In error', error);
      if (error.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple Sign-In Error', error.message || 'Apple authentication failed.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <View style={styles.container}>

      {/* ── Full-Bleed Background Image ── */}
      <AnimatedExpoImage
        source={require('@/assets/images/login-bg.jpg')}
        style={[styles.bgImage, { transform: [{ scale: bgScale }] }]}
        contentFit="cover"
      />

      {/* ── Netflix-style multi-stop cinematic gradient ── */}
      <Animated.View style={[styles.topGradient, { opacity: gradientOpacity }]}>
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'transparent']}
          locations={[0, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={[styles.bottomGradient, { opacity: gradientOpacity }]}>
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.60)', 'rgba(0,0,0,0.92)', '#000000']}
          locations={[0, 0.35, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── Top Bar: Logo ── */}
      <Animated.View
        style={[
          styles.topBar,
          {
            opacity: logoFadeAnim,
            transform: [
              { translateY: logoTranslateY },
              { scale: logoScale },
            ],
          },
        ]}
      >
        <Image
          source={require('@/assets/images/logo-white.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* ── Step 1: Phone Onboarding Modal Overlay ── */}
      {step === 'phone' && (
        <PhoneView
          onSuccess={handlePhoneComplete}
          onCancel={async () => {
            await useAuthStore.getState().logout();
            setStep('login');
          }}
        />
      )}

      {/* ── Step 2: Selfie Onboarding Modal Overlay ── */}
      {step === 'selfie' && (
        <CameraViewScreen
          onSuccess={handleSelfieComplete}
          onCancel={async () => {
            await useAuthStore.getState().logout();
            setStep('login');
          }}
        />
      )}

      {/* ── Default: Sign-In Buttons ── */}
      {step === 'login' && (
        <>
          {/* ── Center: Headline ── */}
          <Animated.View
            style={[
              styles.centerSection,
              { opacity: fadeAnim },
            ]}
          >
            <Text style={styles.headline}>MY CIRCLE</Text>
            <Text style={styles.subBrand}>BY MISTY VISUALS</Text>
            <Text style={styles.tagline}>Relive the celebrations{'\n'}that matter most.</Text>
          </Animated.View>


      {/* ── Bottom: Sign-In Buttons ── */}
      <View style={styles.bottomSection}>
        {isLoggingIn ? (
          <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
        ) : (
          <>
            {/* Google Button — solid white fill with fast slide-fade */}
            <Animated.View
              style={{
                width: '100%',
                opacity: googleAnim,
                transform: [{ translateY: googleSlide }],
              }}
            >
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={signInWithGoogle}
              >
                <Image
                  source={require('@/assets/images/google-icon.png')}
                  style={styles.btnIcon}
                  resizeMode="contain"
                />
                <Text style={styles.primaryBtnLabel}>Continue with Google</Text>
              </Pressable>
            </Animated.View>

            {/* Apple Button — outline ghost style with medium slide-fade (iOS only) */}
            {Platform.OS === 'ios' && (
              <Animated.View
                style={{
                  width: '100%',
                  opacity: appleAnim,
                  transform: [{ translateY: appleSlide }],
                }}
              >
                <Pressable
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                  onPress={signInWithApple}
                >
                  <Image
                    source={require('@/assets/images/apple-logo-icon.png')}
                    style={[styles.btnIcon, styles.appleIconTint]}
                    resizeMode="contain"
                  />
                  <Text style={styles.secondaryBtnLabel}>Continue with Apple</Text>
                </Pressable>
              </Animated.View>
            )}

            {/* Facebook Button — outline ghost style with medium slide-fade (Android only) */}
            {Platform.OS === 'android' && (
              <Animated.View
                style={{
                  width: '100%',
                  opacity: appleAnim,
                  transform: [{ translateY: appleSlide }],
                }}
              >
                <Pressable
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                  onPress={signInWithFacebook}
                >
                  <Image
                    source={require('@/assets/images/facebook-icon.png')}
                    style={styles.fbIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.secondaryBtnLabel}>Continue with Facebook</Text>
                </Pressable>
              </Animated.View>
            )}

            {/* Disclaimer line — smooth slow fade-in */}
            <Animated.View
              style={{
                opacity: termsAnim,
                transform: [{ translateY: termsSlide }],
              }}
            >
              <Text style={styles.disclaimer}>
                By signing in, you agree to our{' '}
                <Text style={styles.disclaimerLink} onPress={openTerms}>
                  Terms
                </Text>{' '}
                &{' '}
                <Text style={styles.disclaimerLink} onPress={openPrivacy}>
                  Privacy Policy
                </Text>
              </Text>
            </Animated.View>
          </>
        )}
      </View>
        </>
      )}

      {/* ── In-App Web View Modal (100% In-App for iOS & Android) ── */}
      <Modal
        visible={!!webModal}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setWebModal(null)}
      >
        <SafeAreaView style={styles.webModalContainer}>
          <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
          <View style={styles.webModalHeader}>
            <Text style={styles.webModalTitle}>{webModal?.title}</Text>
            <Pressable onPress={() => setWebModal(null)} style={styles.webModalCloseBtn}>
              <Text style={styles.webModalCloseText}>Done</Text>
            </Pressable>
          </View>
          {webModal && (
            <WebView
              source={{ uri: webModal.url }}
              style={styles.webView}
              startInLoadingState
              renderLoading={() => (
                <ActivityIndicator size="large" color="#000000" style={styles.webLoading} />
              )}
            />
          )}
        </SafeAreaView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },

  /* ── Background ── */
  bgImage: {
    position: 'absolute',
    width: SCREEN.width,
    height: SCREEN.height,
    top: 0,
    left: 0,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN.height * 0.35,
  },

  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN.height * 0.65,
  },

  /* ── Top Bar ── */
  topBar: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  logo: {
    height: 52,
    width: 210,
  },

  /* ── Center Headline ── */
  centerSection: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: SCREEN.height * 0.30,
    alignItems: 'center',
  },
  headline: {
    fontFamily: FONT_FUTURA,
    fontSize: 40,
    color: '#ffffff',
    letterSpacing: 6,
    marginBottom: 6,
    textAlign: 'center',
    lineHeight: 46,
  },
  subBrand: {
    fontFamily: FONT_FUTURA,
    fontSize: 13,
    color: 'rgba(255,255,255,0.80)',
    letterSpacing: 4,
    marginBottom: 20,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  tagline: {
    fontFamily: FONT_FUTURA,
    fontSize: 17,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.3,
    textAlign: 'center',
    lineHeight: 25,
  },

  /* ── Bottom Buttons ── */
  bottomSection: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    alignItems: 'center',
    gap: 12,
  },
  loader: {
    marginVertical: 32,
  },

  /* Primary: solid white */
  primaryBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#ffffff',
    borderRadius: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryBtnLabel: {
    fontFamily: FONT_FUTURA,
    color: '#000000',
    fontSize: 15,
    letterSpacing: 0.3,
  },

  /* Secondary: glass outline */
  secondaryBtn: {
    width: '100%',
    height: 52,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryBtnLabel: {
    fontFamily: FONT_FUTURA,
    color: '#ffffff',
    fontSize: 15,
    letterSpacing: 0.3,
  },

  btnIcon: {
    width: 20,
    height: 20,
  },
  fbIcon: {
    width: 20,
    height: 22,
  },
  appleIconTint: {
    tintColor: '#ffffff',
  },
  btnPressed: {
    opacity: 0.75,
  },

  /* Disclaimer */
  disclaimer: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  disclaimerLink: {
    color: 'rgba(255,255,255,0.70)',
    textDecorationLine: 'underline',
  },

  /* In-App Web View Modal Styles */
  webModalContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 28) : 0,
  },
  webModalHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
    backgroundColor: '#ffffff',
  },
  webModalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  webModalCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  webModalCloseText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#007AFF',
  },
  webView: {
    flex: 1,
  },
  webLoading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

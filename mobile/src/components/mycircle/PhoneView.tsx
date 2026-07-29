import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PhoneViewProps {
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function PhoneView({ onSuccess, onCancel }: PhoneViewProps) {
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const profile = useAuthStore((state) => state.profile);
  const eventSlug = useAuthStore((state) => state.eventSlug);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const handleCountryCodeChange = (text: string) => {
    setErrorMsg('');
    if (!text.startsWith('+')) {
      const clean = text.replace(/\D/g, '');
      setCountryCode('+' + clean);
    } else {
      const prefix = text.slice(0, 1);
      const rest = text.slice(1).replace(/\D/g, '');
      setCountryCode(prefix + rest);
    }
  };

  const handleSubmit = async () => {
    const cleanCode = countryCode.trim();
    const cleanDigits = phoneNumber.replace(/\D/g, '');

    if (cleanCode.length < 2) {
      setErrorMsg('Please enter a valid country code (e.g. +91)');
      return;
    }

    if (!cleanDigits) {
      setErrorMsg('Please enter your mobile number');
      return;
    }

    // 1. India (+91): Exactly 10 digits, starts with 6, 7, 8, or 9
    if (cleanCode === '+91') {
      if (cleanDigits.length !== 10 || !/^[6-9]/.test(cleanDigits)) {
        setErrorMsg('Invalid Indian number (must be 10 digits starting with 6-9)');
        return;
      }
    } 
    // 2. USA / Canada (+1): Exactly 10 digits, area code starts with 2-9
    else if (cleanCode === '+1') {
      if (cleanDigits.length !== 10 || !/^[2-9]/.test(cleanDigits)) {
        setErrorMsg('Invalid US/Canada number (must be 10 digits)');
        return;
      }
    } 
    // 3. UK (+44): 10 digits, mobile numbers start with 7
    else if (cleanCode === '+44') {
      if (cleanDigits.length !== 10 || !/^7/.test(cleanDigits)) {
        setErrorMsg('Invalid UK mobile number (must be 10 digits starting with 7)');
        return;
      }
    } 
    // 4. UAE (+971): 9 digits, mobile numbers start with 5
    else if (cleanCode === '+971') {
      if (cleanDigits.length !== 9 || !/^5/.test(cleanDigits)) {
        setErrorMsg('Invalid UAE mobile number (must be 9 digits starting with 5)');
        return;
      }
    } 
    // 5. Australia (+61): 9 digits, mobile numbers start with 4
    else if (cleanCode === '+61') {
      if (cleanDigits.length !== 9 || !/^4/.test(cleanDigits)) {
        setErrorMsg('Invalid Australian mobile number (must be 9 digits starting with 4)');
        return;
      }
    } 
    // 6. Singapore (+65): 8 digits, mobile numbers start with 8 or 9
    else if (cleanCode === '+65') {
      if (cleanDigits.length !== 8 || !/^[89]/.test(cleanDigits)) {
        setErrorMsg('Invalid Singapore mobile number (must be 8 digits starting with 8 or 9)');
        return;
      }
    } 
    // 7. All other international country codes (ITU E.164 standard: 6 to 14 digits)
    else {
      if (cleanDigits.length < 6 || cleanDigits.length > 14) {
        setErrorMsg('Please enter a valid mobile number for this country code');
        return;
      }
    }

    const fullPhoneNumber = `${cleanCode}${cleanDigits}`;

    try {
      setIsSubmitting(true);
      setErrorMsg('');

      const hasValidEventSlug = Boolean(eventSlug && eventSlug !== 'null' && eventSlug !== 'undefined');
      const updateUrl = hasValidEventSlug
        ? `/api/gallery/public/events/${eventSlug}/phone`
        : `/api/gallery/family/profile/update`;

      const payload = hasValidEventSlug
        ? { phoneNumber: fullPhoneNumber }
        : { phoneNumber: fullPhoneNumber, name: profile?.name || '' };

      await api.post(updateUrl, payload);
      
      // Update local profile state
      await updateProfile({ phoneNumber: fullPhoneNumber });
      onSuccess();
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Failed to save phone number. Please try again.';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Pressable style={styles.overlay} onPress={onCancel}>
      <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.title}>ENTER YOUR PHONE NUMBER</Text>
        <Text style={styles.subtitle}>
          We will use this to notify you if additional photos of you are uploaded to the gallery.
        </Text>

        <View style={styles.divider} />

        <View style={[styles.phoneInputRow, !!errorMsg && styles.inputErrorRow]}>
          <TextInput
            style={styles.countryCodeInput}
            placeholder="+91"
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            keyboardType="phone-pad"
            maxLength={5}
            value={countryCode}
            onChangeText={handleCountryCodeChange}
            editable={!isSubmitting}
          />

          <View style={styles.verticalDivider} />

          <TextInput
            style={styles.inputField}
            placeholder="Mobile number"
            placeholderTextColor="rgba(255, 255, 255, 0.35)"
            keyboardType="number-pad"
            maxLength={15}
            value={phoneNumber}
            onChangeText={(text) => {
              setErrorMsg('');
              setPhoneNumber(text.replace(/\D/g, ''));
            }}
            editable={!isSubmitting}
          />
        </View>

        {!!errorMsg && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isSubmitting && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    borderRadius: 0,
    paddingVertical: 36,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.45,
    shadowRadius: 40,
    elevation: 20,
  },
  title: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '500',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: 2.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#a3a3a3',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 24,
  },
  phoneInputRow: {
    width: '100%',
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  inputErrorRow: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  countryCodeInput: {
    width: 64,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  verticalDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  inputField: {
    flex: 1,
    height: '100%',
    color: '#ffffff',
    fontSize: 15,
    paddingHorizontal: 14,
    letterSpacing: 1.5,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 16,
  },
  button: {
    width: '100%',
    height: 46,
    backgroundColor: '#ffffff',
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  buttonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  backBtn: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backBtnText: {
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
});

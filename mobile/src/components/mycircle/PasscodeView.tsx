import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface PasscodeViewProps {
  onSuccess: (passcode: string) => void;
  onBack: () => void;
}

export default function PasscodeView({ onSuccess, onBack }: PasscodeViewProps) {
  const [passcode, setPasscode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const eventSlug = useAuthStore((state) => state.eventSlug);
  const token = useAuthStore((state) => state.token);
  const setEventDetails = useAuthStore((state) => state.setEventDetails);

  const handleSubmit = async () => {
    const trimmed = passcode.trim();
    if (!trimmed) {
      Alert.alert('Empty Passcode', 'Please enter the event passcode.');
      return;
    }

    try {
      setIsSubmitting(true);

      // Verify the passcode by authenticating with auth-from-family endpoint
      let res;
      try {
        res = await api.post(
          `/api/gallery/public/events/${eventSlug}/auth-from-family`,
          { code: trimmed },
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
      } catch (authErr) {
        // Fallback to upgrade endpoint if auth-from-family returns error
        res = await api.post(
          `/api/gallery/public/events/${eventSlug}/upgrade`,
          { code: trimmed },
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
      }
      
      const { token: newToken } = res.data;
      
      // Update local storage/state with the verified passcode
      setEventDetails(eventSlug, trimmed);
      onSuccess(trimmed);
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.error || 'Invalid passcode. Please try again.';
      Alert.alert('Authentication Failed', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter Event Passcode</Text>
      <Text style={styles.subtitle}>
        This private gallery is passcode-protected. Enter the passcode provided by the host to view your photos.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter Passcode"
        placeholderTextColor="rgba(0, 0, 0, 0.4)"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={true}
        value={passcode}
        onChangeText={setPasscode}
        editable={!isSubmitting}
      />

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
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.buttonText}>Submit</Text>
        )}
      </Pressable>

      <Pressable style={styles.backBtn} onPress={onBack} disabled={isSubmitting}>
        <Text style={styles.backBtnText}>Change Event</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    padding: 30,
  },
  title: {
    fontSize: 20,
    color: '#000000',
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 35,
  },
  input: {
    width: '100%',
    padding: 15,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
    color: '#000000',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 3,
  },
  button: {
    width: '100%',
    padding: 15,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  backBtn: {
    marginTop: 25,
    alignItems: 'center',
  },
  backBtnText: {
    color: 'rgba(0, 0, 0, 0.5)',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

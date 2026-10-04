import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { savesService, SavedPhotoItem } from '../../services/savesService';
import {
  FONT_FUTURA_BOLD,
  FONT_MONTSERRAT_REGULAR,
  FONT_MONTSERRAT_SEMIBOLD,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const PREDEFINED_TAGS = [
  '#Haldi',
  '#Mehendi',
  '#Sangeet',
  '#Wedding',
  '#Reception',
  '#Decor',
  '#Outfits',
  '#Poses',
  '#Jewelry',
  '#Makeup',
];

interface AddInspirationModalProps {
  visible: boolean;
  displayRole?: string;
  onClose: () => void;
  onUploadStart?: (payload: { localUri: string; tags: string[]; displayRole?: string }) => void;
  onSuccess: (savedItem: SavedPhotoItem) => void;
}

export const AddInspirationModal: React.FC<AddInspirationModalProps> = ({
  visible,
  displayRole,
  onClose,
  onUploadStart,
  onSuccess,
}) => {
  const insets = useSafeAreaInsets();
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset state when modal is closed
  useEffect(() => {
    if (!visible) {
      setSelectedUri(null);
      setSelectedTags([]);
      setCustomTagInput('');
      setErrorMessage(null);
    }
  }, [visible]);

  const pickFromLibrary = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedUri(result.assets[0].uri);
        setErrorMessage(null);
      }
    } catch (err: any) {
      console.warn('[AddInspirationModal] Error opening photo library:', err);
      setErrorMessage('Could not open photo library. Please try again.');
    }
  };

  const takePhotoWithCamera = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setErrorMessage('Camera access is needed to capture photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.9,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedUri(result.assets[0].uri);
        setErrorMessage(null);
      }
    } catch (err: any) {
      console.warn('[AddInspirationModal] Error launching camera:', err);
      setErrorMessage('Could not open camera.');
    }
  };

  const toggleTag = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const trimmed = customTagInput.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!selectedTags.includes(formatted)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setSelectedTags((prev) => [...prev, formatted]);
    }
    setCustomTagInput('');
  };

  const handleUpload = async () => {
    if (!selectedUri) return;
    const uriToUpload = selectedUri;
    const tagsToUpload = [...selectedTags];

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (onUploadStart) {
      onUploadStart({
        localUri: uriToUpload,
        tags: tagsToUpload,
        displayRole: displayRole,
      });
      setSelectedUri(null);
      setSelectedTags([]);
      setCustomTagInput('');
      setErrorMessage(null);
      onClose();
      return;
    }

    // Fallback if onUploadStart not provided
    setIsUploading(true);
    setErrorMessage(null);

    try {
      const savedItem = await savesService.uploadInspirationPhoto(uriToUpload, tagsToUpload, displayRole);
      if (savedItem) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSelectedUri(null);
        setSelectedTags([]);
        setCustomTagInput('');
        onSuccess(savedItem);
        onClose();
      } else {
        throw new Error('Upload completed without response.');
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setErrorMessage(err.message || 'Failed to upload photo. Please check connection and try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleModalClose = () => {
    if (isUploading) return;
    setSelectedUri(null);
    setSelectedTags([]);
    setCustomTagInput('');
    setErrorMessage(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleModalClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleModalClose} />

        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerSubtitle}>NEW INSPIRATION</Text>
              <Text style={styles.headerTitle}>
                {selectedUri ? 'TAG & SAVE' : 'CHOOSE PHOTO'}
              </Text>
            </View>
            <Pressable
              onPress={handleModalClose}
              style={styles.closeButton}
              hitSlop={12}
              disabled={isUploading}
            >
              <Ionicons name="close" size={20} color="#111111" />
            </Pressable>
          </View>

          {/* Body */}
          {selectedUri ? (
            /* Selected Photo & Tagging View */
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.imagePreviewWrapper}>
                <Image
                  source={{ uri: selectedUri }}
                  style={styles.imagePreview}
                  contentFit="contain"
                />
                <Pressable
                  style={styles.changePhotoBtn}
                  onPress={pickFromLibrary}
                  disabled={isUploading}
                >
                  <Ionicons name="images" size={14} color="#ffffff" />
                  <Text style={styles.changePhotoText}>Change Photo</Text>
                </Pressable>
              </View>

              {/* Tags Section */}
              <View style={styles.tagsSection}>
                <Text style={styles.sectionTitle}>TAG YOUR INSPIRATION (OPTIONAL)</Text>
                <Text style={styles.sectionDesc}>
                  Add event or category tags to easily filter poses, outfits, and decor later.
                </Text>

                {/* Tag Chips */}
                <View style={styles.tagChipsContainer}>
                  {PREDEFINED_TAGS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <Pressable
                        key={tag}
                        onPress={() => toggleTag(tag)}
                        style={[styles.tagChip, isSelected && styles.tagChipSelected]}
                      >
                        <Text style={[styles.tagChipText, isSelected && styles.tagChipTextSelected]}>
                          {tag}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* Custom user tags */}
                  {selectedTags
                    .filter((t) => !PREDEFINED_TAGS.includes(t))
                    .map((tag) => (
                      <Pressable
                        key={tag}
                        onPress={() => toggleTag(tag)}
                        style={[styles.tagChip, styles.tagChipSelected]}
                      >
                        <Text style={[styles.tagChipText, styles.tagChipTextSelected]}>
                          {tag} ✕
                        </Text>
                      </Pressable>
                    ))}
                </View>

                {/* Custom Tag Input */}
                <View style={styles.customTagRow}>
                  <TextInput
                    style={styles.customTagInput}
                    placeholder="Add custom tag (e.g. #MandapDecor)"
                    placeholderTextColor="#999999"
                    value={customTagInput}
                    onChangeText={setCustomTagInput}
                    onSubmitEditing={addCustomTag}
                    returnKeyType="done"
                    autoCapitalize="none"
                  />
                  <Pressable
                    style={[styles.addCustomTagBtn, !customTagInput.trim() && styles.addCustomTagBtnDisabled]}
                    onPress={addCustomTag}
                    disabled={!customTagInput.trim()}
                  >
                    <Text style={styles.addCustomTagBtnText}>+ Add</Text>
                  </Pressable>
                </View>
              </View>

              {errorMessage ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color="#e11d48" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              {/* Action Button */}
              <View style={styles.footer}>
                <Pressable
                  style={[styles.uploadButton, isUploading && styles.uploadButtonDisabled]}
                  onPress={handleUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <View style={styles.uploadingContainer}>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.uploadButtonText}>SAVING TO MOODBOARD...</Text>
                    </View>
                  ) : (
                    <Text style={styles.uploadButtonText}>SAVE TO MOODBOARD ✨</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            /* System Picker Selection Options */
            <View style={styles.pickerOptionsContainer}>
              <Text style={styles.pickerInstructions}>
                Select an inspiration image from your photos or capture a live moment to tag and pin to your moodboard.
              </Text>

              <Pressable
                style={styles.pickerCard}
                onPress={pickFromLibrary}
                android_ripple={{ color: '#f3f4f6' }}
              >
                <View style={styles.pickerCardIconBg}>
                  <Ionicons name="images" size={24} color="#111111" />
                </View>
                <View style={styles.pickerCardText}>
                  <Text style={styles.pickerCardTitle}>CHOOSE FROM PHOTOS</Text>
                  <Text style={styles.pickerCardSubtitle}>Browse albums & select from your device</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#999999" />
              </Pressable>

              <Pressable
                style={styles.pickerCard}
                onPress={takePhotoWithCamera}
                android_ripple={{ color: '#f3f4f6' }}
              >
                <View style={styles.pickerCardIconBg}>
                  <Ionicons name="camera" size={24} color="#111111" />
                </View>
                <View style={styles.pickerCardText}>
                  <Text style={styles.pickerCardTitle}>TAKE A PHOTO</Text>
                  <Text style={styles.pickerCardSubtitle}>Capture a live inspiration moment</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#999999" />
              </Pressable>

              {errorMessage ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color="#e11d48" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    minHeight: '40%',
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerSubtitle: {
    fontSize: 10,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 2,
    color: '#888888',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FONT_FUTURA_BOLD,
    color: '#111111',
    letterSpacing: 0.5,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerOptionsContainer: {
    paddingVertical: 20,
    gap: 14,
  },
  pickerInstructions: {
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#666666',
    lineHeight: 19,
    marginBottom: 6,
  },
  pickerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#eaeaea',
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  pickerCardIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCardText: {
    flex: 1,
  },
  pickerCardTitle: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#111111',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  pickerCardSubtitle: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#777777',
  },
  scrollContent: {
    paddingVertical: 16,
  },
  imagePreviewWrapper: {
    width: '100%',
    height: 220,
    backgroundColor: '#18181b',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  changePhotoBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  changePhotoText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
  },
  tagsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.2,
    color: '#333333',
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 12,
    fontFamily: FONT_JOST_REGULAR,
    color: '#777777',
    lineHeight: 17,
    marginBottom: 12,
  },
  tagChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#f4f4f5',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  tagChipSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  tagChipText: {
    fontSize: 12,
    fontFamily: FONT_JOST_MEDIUM,
    color: '#444444',
  },
  tagChipTextSelected: {
    color: '#ffffff',
    fontFamily: FONT_JOST_SEMIBOLD,
  },
  customTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  customTagInput: {
    flex: 1,
    height: 42,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 13,
    fontFamily: FONT_JOST_REGULAR,
    color: '#111111',
    borderWidth: 1,
    borderColor: '#eaeaea',
  },
  addCustomTagBtn: {
    height: 42,
    paddingHorizontal: 16,
    backgroundColor: '#27272a',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCustomTagBtnDisabled: {
    backgroundColor: '#e4e4e7',
  },
  addCustomTagBtnText: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    color: '#ffffff',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff1f2',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: FONT_JOST_MEDIUM,
    color: '#e11d48',
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  uploadButton: {
    width: '100%',
    height: 50,
    backgroundColor: '#111111',
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  uploadButtonDisabled: {
    backgroundColor: '#888888',
  },
  uploadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadButtonText: {
    fontSize: 12,
    fontFamily: FONT_MONTSERRAT_SEMIBOLD,
    letterSpacing: 1.5,
    color: '#ffffff',
  },
});

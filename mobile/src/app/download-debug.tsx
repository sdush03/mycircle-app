import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  SafeAreaView,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  enqueueSingleItem,
  enqueueBatch,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  clearQueue,
  getAllBatchesSync,
  subscribeBatchProgress,
  BatchStatus,
} from '../../modules/mycircle-background-downloader';

const SAMPLE_SINGLE_PHOTO = {
  id: 'photo_single_sample',
  url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1600&q=80',
  destinationPath: 'downloads/single_photo.jpg',
  fileType: 'PHOTO' as const,
  sourceType: 'INDIVIDUAL_PHOTO' as const,
  exportMode: 'MYCIRCLE_ONLY' as const,
  expectedSizeBytes: 850000,
};

const SAMPLE_BATCH_ALBUM = {
  batchId: 'album_sample_wedding',
  title: 'Sample Wedding Album (5 Photos)',
  sourceType: 'ALBUM' as const,
  exportMode: 'MYCIRCLE_ONLY' as const,
  tasks: [
    {
      id: 'task_1_sample',
      url: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1600&q=80',
      destinationPath: 'downloads/album/photo_1.jpg',
      fileType: 'PHOTO' as const,
      sourceType: 'ALBUM' as const,
      expectedSizeBytes: 920000,
    },
    {
      id: 'task_2_sample',
      url: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=1600&q=80',
      destinationPath: 'downloads/album/photo_2.jpg',
      fileType: 'PHOTO' as const,
      sourceType: 'ALBUM' as const,
      expectedSizeBytes: 1050000,
    },
    {
      id: 'task_3_sample',
      url: 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?w=1600&q=80',
      destinationPath: 'downloads/album/photo_3.jpg',
      fileType: 'PHOTO' as const,
      sourceType: 'ALBUM' as const,
      expectedSizeBytes: 880000,
    },
    {
      id: 'task_4_sample',
      url: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?w=1600&q=80',
      destinationPath: 'downloads/album/photo_4.jpg',
      fileType: 'PHOTO' as const,
      sourceType: 'ALBUM' as const,
      expectedSizeBytes: 970000,
    },
    {
      id: 'task_5_sample',
      url: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1600&q=80',
      destinationPath: 'downloads/album/photo_5.jpg',
      fileType: 'PHOTO' as const,
      sourceType: 'ALBUM' as const,
      expectedSizeBytes: 1100000,
    },
  ],
};

function DownloadDebugScreen() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [allowOverwrite, setAllowOverwrite] = useState(false);

  const refreshFromSQLite = () => {
    try {
      const data = getAllBatchesSync();
      setBatches(data);
    } catch (e) {
      console.error('[DownloadDebug] Failed to query SQLite:', e);
    }
  };

  useEffect(() => {
    refreshFromSQLite();

    const sub = subscribeBatchProgress(() => {
      refreshFromSQLite();
    });

    return () => {
      sub.remove();
    };
  }, []);

  const handleSingleDownload = async () => {
    setLoading(true);
    const task = { ...SAMPLE_SINGLE_PHOTO, overwrite: allowOverwrite };
    const res = await enqueueSingleItem(task);
    setLoading(false);
    refreshFromSQLite();

    if (res.isDuplicate) {
      Alert.alert('Duplicate Detected 🛡️', 'This photo is already downloaded in your library.', [
        { text: 'OK' },
      ]);
    }
  };

  const handleBatchDownload = async () => {
    setLoading(true);
    const batch = {
      ...SAMPLE_BATCH_ALBUM,
      overwrite: allowOverwrite,
    };
    const res = await enqueueBatch(batch);
    setLoading(false);
    refreshFromSQLite();

    if (res.isDuplicate) {
      Alert.alert('Duplicate Album Detected 🛡️', 'This album is already downloaded in your library.', [
        { text: 'OK' },
      ]);
    }
  };

  const handlePause = async (batchId: string) => {
    await pauseBatch(batchId);
    refreshFromSQLite();
  };

  const handleResume = async (batchId: string) => {
    await resumeBatch(batchId);
    refreshFromSQLite();
  };

  const handleCancel = async (batchId: string) => {
    await cancelBatch(batchId);
    refreshFromSQLite();
  };

  const handleClearQueue = async () => {
    await clearQueue();
    refreshFromSQLite();
    Alert.alert('Queue Cleared', 'Cleared native SQLite database tables.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Download Engine Debug</Text>
        <TouchableOpacity onPress={refreshFromSQLite} style={styles.refreshButton}>
          <Ionicons name="refresh" size={20} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Native SQLite Status Banner */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="hardware-chip-outline" size={20} color="#38BDF8" />
            <Text style={styles.statusTitle}>Native SQLite Single Source of Truth</Text>
          </View>
          <Text style={styles.statusSubtitle}>
            `mycircle_downloader.db` active • {batches.length} total recorded batches
          </Text>
        </View>

        {/* Overwrite Toggle */}
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>Force Re-download (Overwrite)</Text>
            <Text style={styles.toggleSubtitle}>When disabled, duplicate downloads are prevented.</Text>
          </View>
          <Switch
            value={allowOverwrite}
            onValueChange={setAllowOverwrite}
            trackColor={{ false: '#334155', true: '#0284C7' }}
            thumbColor={allowOverwrite ? '#38BDF8' : '#94A3B8'}
          />
        </View>

        {/* Action Controls */}
        <View style={styles.actionGrid}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSingleDownload} disabled={loading}>
            <Ionicons name="image-outline" size={18} color="#FFF" />
            <Text style={styles.btnText}>Single Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={handleBatchDownload} disabled={loading}>
            <Ionicons name="images-outline" size={18} color="#FFF" />
            <Text style={styles.btnText}>Batch (5 Photos)</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.clearBtn} onPress={handleClearQueue}>
          <Ionicons name="trash-outline" size={18} color="#F87171" />
          <Text style={styles.clearBtnText}>Clear Native SQLite Queue</Text>
        </TouchableOpacity>

        {/* Live Queue Cards */}
        <Text style={styles.sectionHeader}>Active & Historical Queue ({batches.length})</Text>

        {batches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No download batches in native SQLite queue.</Text>
            <Text style={styles.emptySubtext}>Tap "Single Photo" or "Batch" above to test transfers.</Text>
          </View>
        ) : (
          batches.map((batch) => {
            const percent =
              batch.totalFiles > 0 ? Math.round((batch.completedFiles / batch.totalFiles) * 100) : 0;

            return (
              <View key={batch.batchId} style={styles.batchCard}>
                <View style={styles.batchHeader}>
                  <Text style={styles.batchTitle} numberOfLines={1}>
                    {batch.title}
                  </Text>

                  <View
                    style={[
                      styles.statusPill,
                      batch.status === 'COMPLETED'
                        ? styles.pillSuccess
                        : batch.status === 'DOWNLOADING'
                        ? styles.pillActive
                        : batch.status === 'PAUSED'
                        ? styles.pillPaused
                        : styles.pillFailed,
                    ]}
                  >
                    <Text style={styles.pillText}>{batch.status}</Text>
                  </View>
                </View>

                {/* Progress Stats */}
                <Text style={styles.progressDetail}>
                  Files: {batch.completedFiles} / {batch.totalFiles} • {percent}%
                </Text>

                {/* Progress Bar */}
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${percent}%` }]} />
                </View>

                {/* Controls */}
                <View style={styles.cardControls}>
                  {(batch.status === 'DOWNLOADING' || batch.status === 'QUEUED') && (
                    <TouchableOpacity style={styles.controlBtn} onPress={() => handlePause(batch.batchId)}>
                      <Ionicons name="pause" size={16} color="#FBBF24" />
                      <Text style={[styles.controlText, { color: '#FBBF24' }]}>Pause</Text>
                    </TouchableOpacity>
                  )}

                  {batch.status === 'PAUSED' && (
                    <TouchableOpacity style={styles.controlBtn} onPress={() => handleResume(batch.batchId)}>
                      <Ionicons name="play" size={16} color="#34D399" />
                      <Text style={[styles.controlText, { color: '#34D399' }]}>Resume</Text>
                    </TouchableOpacity>
                  )}

                  {batch.status !== 'COMPLETED' && batch.status !== 'CANCELLED' && (
                    <TouchableOpacity style={styles.controlBtn} onPress={() => handleCancel(batch.batchId)}>
                      <Ionicons name="close-circle-outline" size={16} color="#F87171" />
                      <Text style={[styles.controlText, { color: '#F87171' }]}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: { padding: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  refreshButton: { padding: 4 },
  content: { padding: 16 },
  statusCard: {
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  statusTitle: { fontSize: 14, fontWeight: '600', color: '#38BDF8' },
  statusSubtitle: { fontSize: 12, color: '#94A3B8' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleTitle: { fontSize: 13, fontWeight: '600', color: '#FFF' },
  toggleSubtitle: { fontSize: 11, color: '#94A3B8' },
  actionGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#0D9488',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#450A0A',
    marginBottom: 20,
  },
  clearBtnText: { color: '#F87171', fontWeight: '600', fontSize: 12 },
  sectionHeader: { fontSize: 15, fontWeight: '700', color: '#E2E8F0', marginBottom: 12 },
  emptyCard: {
    backgroundColor: '#1E293B',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
  emptySubtext: { color: '#64748B', fontSize: 12, marginTop: 4 },
  batchCard: {
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  batchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  batchTitle: { fontSize: 14, fontWeight: '600', color: '#FFF', flex: 1, marginRight: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  pillSuccess: { backgroundColor: '#065F46' },
  pillActive: { backgroundColor: '#1E40AF' },
  pillPaused: { backgroundColor: '#92400E' },
  pillFailed: { backgroundColor: '#991B1B' },
  pillText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  progressDetail: { fontSize: 12, color: '#94A3B8', marginBottom: 6 },
  progressBarBg: { height: 6, backgroundColor: '#334155', borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  progressBarFill: { height: '100%', backgroundColor: '#38BDF8' },
  cardControls: { flexDirection: 'row', gap: 12 },
  controlBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  controlText: { fontSize: 12, fontWeight: '600' },
});

export default DownloadDebugScreen;

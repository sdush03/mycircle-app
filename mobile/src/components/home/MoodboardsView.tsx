import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  ScrollView,
  Image,
  Pressable,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CollectionGridView, { CollectionItem } from './CollectionGridView';
import { formatUniversalGalleryImages } from '../../utils/masonryHelper';
import {
  FONT_MONTSERRAT_REGULAR,
  FONT_JOST_REGULAR,
  FONT_JOST_MEDIUM,
  FONT_JOST_SEMIBOLD,
} from '../../constants/fonts';

const { width } = Dimensions.get('window');

export interface Moodboard {
  id: string | number;
  slug?: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  coverImage?: any;
  coverImageMobile?: any;
  images?: any[];
}

interface MoodboardsViewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBoardId?: string | number | null;
  selectedCategoryName?: string;
  inspirations?: Moodboard[];
  categoryCards?: any[];
  onSelectInspiration?: (board: Moodboard) => void;
}

export default function MoodboardsView({
  isOpen,
  onClose,
  selectedBoardId,
  selectedCategoryName,
  inspirations,
  categoryCards,
  onSelectInspiration,
}: MoodboardsViewProps) {
  const insets = useSafeAreaInsets();
  const [activeBoard, setActiveBoard] = useState<Moodboard | null>(null);
  const [fetchedBoards, setFetchedBoards] = useState<Moodboard[]>([]);

  // Fetch dynamic inspirations from backend API if not passed via props
  React.useEffect(() => {
    if (isOpen) {
      if (inspirations && inspirations.length > 0) {
        setFetchedBoards(inspirations);
      } else {
        fetch('https://www.mistyvisuals.com/api/app/inspirations')
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setFetchedBoards(data);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, inspirations]);

  const displayBoards = fetchedBoards.length > 0 ? fetchedBoards : (inspirations || []);

  // Set default active board on open if specified
  React.useEffect(() => {
    if (isOpen) {
      if (selectedBoardId !== null && selectedBoardId !== undefined) {
        const found = displayBoards.find((b) => String(b.id) === String(selectedBoardId));
        if (found) {
          if (onSelectInspiration) {
            onClose();
            onSelectInspiration(found);
          } else {
            setActiveBoard(found);
          }
        }
      }
    }
  }, [isOpen, selectedBoardId, displayBoards, onSelectInspiration, onClose]);

  // Android hardware back button handler for active board view
  React.useEffect(() => {
    if (!isOpen || !activeBoard) return;
    const onBackPress = () => {
      setActiveBoard(null);
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [isOpen, activeBoard]);

  const collectionItems: CollectionItem[] = React.useMemo(() => {
    return displayBoards.map((board) => {
      const horizontalCover = board.coverImage || board.coverImageMobile || (board.images && board.images[0]);
      const verticalCover = board.coverImageMobile || board.coverImage || (board.images && board.images[0]);
      const photoCount = Array.isArray(board.images) ? board.images.length : 0;
      const subtext = photoCount > 0 ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'} →` : 'Explore Collection →';

      const galleryImages = formatUniversalGalleryImages(board.images || [], board.title, board.category || 'INSPIRATION');

      const formattedBoard = {
        id: String(board.id),
        title: board.title,
        subtitle: board.subtitle || board.category || 'FINE ART INSPIRATION',
        location: 'CURATED COLLECTION',
        date: 'INSPIRATION',
        coverImage: typeof verticalCover === 'string' ? { uri: verticalCover } : verticalCover,
        description: board.description || '',
        images: galleryImages,
        tabs: [board.category || 'INSPIRATION'],
      };

      return {
        id: board.id,
        title: board.title,
        category: board.category,
        subtext: board.subtitle || subtext,
        coverImage: verticalCover,
        horizontalCoverImage: horizontalCover,
        rawItem: formattedBoard,
      };
    });
  }, [displayBoards]);

  const handleCardPress = (board: Moodboard) => {
    if (onSelectInspiration) {
      onSelectInspiration(board);
    } else {
      setActiveBoard(board);
    }
  };

  if (activeBoard) {
    return (
      <Modal visible={isOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setActiveBoard(null)}>
        <View style={styles.container}>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
            <Pressable style={styles.backButton} onPress={() => setActiveBoard(null)}>
              <Text style={styles.backText}>← BACK</Text>
            </Pressable>
            <Text style={styles.headerTitle}>FINE ART INSPIRATION</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.boardCategory}>{(activeBoard.category || 'INSPIRATION COLLECTION').toUpperCase()}</Text>
            <Text style={styles.boardTitle}>{activeBoard.title}</Text>
            {activeBoard.subtitle ? <Text style={styles.boardSubtitle}>{activeBoard.subtitle}</Text> : null}
            {activeBoard.description ? <Text style={styles.boardDescription}>{activeBoard.description}</Text> : null}

            <View style={styles.divider} />

            <View style={styles.gridContainer}>
              {(activeBoard.images || []).map((img, idx) => (
                <View key={idx} style={styles.gridCard}>
                  <Image source={typeof img === 'string' ? { uri: img } : img} style={styles.gridImage} />
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  return (
    <CollectionGridView
      isOpen={isOpen}
      onClose={onClose}
      headerTitle="Aesthetics"
      headerDescription="Curated moods, visual details and fine art inspiration. Browse by vibe to find the aesthetic that speaks to your celebration."
      sectionHeadingPrefix="BROWSE BY VIBE"
      items={collectionItems}
      initialCategory={selectedCategoryName || 'All'}
      customCategoryCards={categoryCards}
      onSelectItem={(item) => handleCardPress(item.rawItem)}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12100e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#24211e',
    backgroundColor: 'rgba(18, 16, 14, 0.96)',
  },
  backButton: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 11,
    letterSpacing: 1.5,
    color: '#d0c8be',
  },
  headerTitle: {
    fontFamily: FONT_JOST_MEDIUM,
    fontSize: 11,
    letterSpacing: 2.5,
    color: '#9a7d52',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 60,
  },
  boardCategory: {
    fontFamily: FONT_JOST_SEMIBOLD,
    fontSize: 9,
    letterSpacing: 2,
    color: '#a07850',
    marginBottom: 6,
  },
  boardTitle: {
    fontFamily: FONT_MONTSERRAT_REGULAR,
    fontSize: 24,
    color: '#ffffff',
    marginBottom: 6,
  },
  boardSubtitle: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 13,
    color: '#d0c8be',
    marginBottom: 10,
  },
  boardDescription: {
    fontFamily: FONT_JOST_REGULAR,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#a0988e',
  },
  divider: {
    height: 1,
    backgroundColor: '#24211e',
    marginVertical: 20,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: (width - 52) / 2,
    aspectRatio: 3 / 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: '#1c1a18',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
});

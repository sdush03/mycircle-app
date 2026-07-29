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

export interface InspirationItem {
  id: string | number;
  slug?: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  location?: string;
  date?: string;
  coverImage?: any;
  coverImageMobile?: any;
  images?: any[];
  type?: 'moodboard' | 'story' | 'aesthetic';
}

interface InspirationsViewProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBoardId?: string | number | null;
  selectedCategoryName?: string;
  inspirations?: InspirationItem[];
  stories?: InspirationItem[];
  categoryCards?: any[];
  onSelectInspiration?: (item: InspirationItem) => void;
}

export default function InspirationsView({
  isOpen,
  onClose,
  selectedBoardId,
  selectedCategoryName,
  inspirations = [],
  stories = [],
  categoryCards,
  onSelectInspiration,
}: InspirationsViewProps) {
  const [fetchedInspirations, setFetchedInspirations] = useState<InspirationItem[]>([]);
  const [fetchedStories, setFetchedStories] = useState<InspirationItem[]>([]);

  // Fetch dynamic inspirations & stories from backend API if not passed via props
  React.useEffect(() => {
    if (isOpen) {
      if (inspirations && inspirations.length > 0) {
        setFetchedInspirations(inspirations);
      } else {
        fetch('https://www.mistyvisuals.com/api/app/inspirations')
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setFetchedInspirations(data);
            }
          })
          .catch(() => {});
      }

      if (stories && stories.length > 0) {
        setFetchedStories(stories);
      } else {
        fetch('https://www.mistyvisuals.com/api/website/stories')
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setFetchedStories(data);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, inspirations, stories]);

  const displayInspirations = fetchedInspirations.length > 0 ? fetchedInspirations : inspirations;
  const displayStories = fetchedStories.length > 0 ? fetchedStories : stories;

  // Combine both Aesthetic Moodboards & Real Stories into unified Inspiration Collection items
  const collectionItems: CollectionItem[] = React.useMemo(() => {
    const items: CollectionItem[] = [];

    // 1. Add Moodboards / Aesthetics
    displayInspirations.forEach((board) => {
      const horizontalCover = board.coverImage || board.coverImageMobile || (board.images && board.images[0]);
      const verticalCover = board.coverImageMobile || board.coverImage || (board.images && board.images[0]);
      const photoCount = Array.isArray(board.images) ? board.images.length : 0;
      const subtext = photoCount > 0 ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'} • AESTHETIC BOARD →` : 'EXPLORE BOARD →';

      const galleryImages = formatUniversalGalleryImages(board.images || [], board.title, board.category || 'INSPIRATION');

      const formattedBoard = {
        id: String(board.id),
        title: board.title,
        subtitle: board.subtitle || board.category || 'FINE ART AESTHETIC',
        location: 'CURATED AESTHETIC',
        date: 'INSPIRATION',
        coverImage: typeof verticalCover === 'string' ? { uri: verticalCover } : verticalCover,
        description: board.description || '',
        images: galleryImages,
        tabs: [board.category || 'INSPIRATION'],
        type: 'moodboard',
      };

      items.push({
        id: `inspo-${board.id}`,
        title: board.title,
        category: board.category || 'Aesthetics',
        location: 'Curated Aesthetic',
        subtext: board.subtitle || subtext,
        coverImage: verticalCover,
        horizontalCoverImage: horizontalCover,
        rawItem: formattedBoard,
      });
    });

    // 2. Add Real Stories tagged by Vibe / Category
    displayStories.forEach((story) => {
      const coverSrc = story.coverImageMobile || story.coverImage || (story.images && story.images[0]);
      const photoCount = Array.isArray(story.images) ? story.images.length : 0;
      const subtext = photoCount > 0 ? `${photoCount} Photos • REAL STORY →` : 'VIEW STORY →';

      const formattedStory = {
        id: String(story.id),
        slug: story.slug,
        title: story.title,
        subtitle: story.subtitle || story.category || 'REAL CELEBRATION',
        location: story.location || 'DESTINATION',
        date: story.date || 'REAL STORY',
        coverImage: typeof coverSrc === 'string' ? { uri: coverSrc } : coverSrc,
        description: story.description || '',
        images: story.images || [],
        tabs: [story.category || 'STORY'],
        type: 'story',
      };

      items.push({
        id: `story-${story.id}`,
        title: story.title,
        category: story.category || 'Real Stories',
        location: story.location || 'Destination',
        subtext: story.subtitle || subtext,
        coverImage: coverSrc,
        horizontalCoverImage: coverSrc,
        rawItem: formattedStory,
      });
    });

    return items;
  }, [displayInspirations, displayStories]);

  const handleSelectItem = (item: CollectionItem) => {
    if (onSelectInspiration) {
      onSelectInspiration(item.rawItem);
    }
  };

  return (
    <CollectionGridView
      isOpen={isOpen}
      onClose={onClose}
      headerTitle="Inspirations"
      headerDescription="Discover fine art moodboards, visual aesthetics, curated vibe collections, and real celebration stories."
      sectionHeadingPrefix="BROWSE BY VIBE"
      items={collectionItems}
      initialCategory={selectedCategoryName || 'All'}
      customCategoryCards={categoryCards}
      onSelectItem={handleSelectItem}
    />
  );
}

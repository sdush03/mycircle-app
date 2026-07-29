import React from 'react';
import CollectionGridView, { CollectionItem } from './CollectionGridView';

interface AllStoriesViewProps {
  isOpen: boolean;
  onClose: () => void;
  stories: any[];
  initialVibe?: string;
  categoryCards?: any[];
  onSelectStory: (story: any) => void;
}

export default function AllStoriesView({
  isOpen,
  onClose,
  stories,
  initialVibe = 'All',
  categoryCards,
  onSelectStory,
}: AllStoriesViewProps) {
  const collectionItems: CollectionItem[] = React.useMemo(() => {
    return stories.map((story) => {
      const horizontalCover =
        story.cover_image_url ||
        story.cover_image_mobile_url ||
        story.grid_image_url ||
        (typeof story.coverImage === 'string' ? story.coverImage : story.coverImage?.uri);

      const verticalCover =
        story.cover_image_mobile_url ||
        story.grid_image_url ||
        story.cover_image_url ||
        (typeof story.coverImage === 'string' ? story.coverImage : story.coverImage?.uri);

      return {
        id: story.id,
        title: story.title,
        category: story.category || 'WEDDING',
        location: story.location,
        coverImage: verticalCover,
        horizontalCoverImage: horizontalCover,
        rawItem: story,
      };
    });
  }, [stories]);

  return (
    <CollectionGridView
      isOpen={isOpen}
      onClose={onClose}
      headerTitle="Portfolio"
      headerDescription="Unscripted moments and intentional design. A closer look into the unique celebrations we’ve had the honor of documenting."
      sectionHeadingPrefix="COLLECTIONS"
      items={collectionItems}
      initialCategory={initialVibe}
      customCategoryCards={categoryCards}
      onSelectItem={(item) => {
        onSelectStory(item.rawItem);
      }}
    />
  );
}

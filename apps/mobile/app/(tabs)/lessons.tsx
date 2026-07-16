/**
 * Lessons tab — placeholder list of the student's enrolled groups +
 * upcoming lessons. Phase 22.2 will hydrate it via
 * `sdk.groups.myEnrollments()` and `sdk.lessons.listForGroup(...)`.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme/colors';

export default function LessonsScreen() {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Mening kurslarim</Text>
        <Pressable style={styles.searchButton}>
          <Ionicons name="search" size={20} color={colors.creamDim} />
        </Pressable>
      </View>

      <View style={styles.filterContainer}>
        <View style={[styles.filterChip, styles.filterChipActive]}>
          <Text style={styles.filterChipTextActive}>Barchasi</Text>
        </View>
        <View style={styles.filterChip}>
          <Text style={styles.filterChipText}>Davom etayotgan</Text>
        </View>
        <View style={styles.filterChip}>
          <Text style={styles.filterChipText}>Yakunlangan</Text>
        </View>
      </View>

      <LessonCard
        title="Frontend React.js"
        instructor="Anvar Soliev"
        progress={0.65}
        lessonsCount={24}
        completedCount={16}
        color="#00E87A"
      />

      <LessonCard
        title="Node.js Backend"
        instructor="Jasur Rahmonov"
        progress={0.3}
        lessonsCount={32}
        completedCount={10}
        color="#60A5FA"
      />

      <LessonCard
        title="UI/UX Dizayn"
        instructor="Malika Abdullaeva"
        progress={0.8}
        lessonsCount={20}
        completedCount={16}
        color="#FBBF24"
      />
    </ScrollView>
  );
}

function LessonCard({
  title,
  instructor,
  progress,
  lessonsCount,
  completedCount,
  color,
}: {
  title: string;
  instructor: string;
  progress: number;
  lessonsCount: number;
  completedCount: number;
  color: string;
}) {
  return (
    <Pressable style={styles.card}>
      <View style={[styles.cardColorStrip, { backgroundColor: color }]} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardInstructor}>{instructor}</Text>
          </View>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.creamDim} />
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressText}>O&apos;zlashtirish</Text>
            <Text style={styles.progressValue}>
              {completedCount}/{lessonsCount} dars
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${progress * 100}%`, backgroundColor: color },
              ]}
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  container: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.cream,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.inkSurface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: spacing.xl,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.inkSurface,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterChipText: {
    ...typography.caption,
    color: colors.creamDim,
  },
  filterChipTextActive: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.ink,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  cardColorStrip: {
    width: 6,
  },
  cardContent: {
    flex: 1,
    padding: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.cream,
  },
  cardInstructor: {
    ...typography.caption,
    color: colors.creamDim,
    marginTop: 2,
  },
  progressContainer: {
    marginTop: spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  progressText: {
    ...typography.caption,
    color: colors.creamDim,
    fontSize: 12,
  },
  progressValue: {
    ...typography.caption,
    color: colors.cream,
    fontWeight: '600',
    fontSize: 12,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.inkSubtle,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: radius.sm,
  },
});

/**
 * Homework tab — placeholder. Phase 22.2 will use
 * `sdk.homework.mySubmissions()` to render the student's submission
 * list grouped by status (DRAFT / SUBMITTED / GRADED / RETURNED).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme/colors';

export default function HomeworkScreen() {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>Uy vazifalari</Text>
      <Text style={styles.subtitle}>
        Topshirilishi kerak bo&apos;lgan va baholangan vazifalar bu yerda
        ko&apos;rinadi.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tez orada</Text>
        <Text style={styles.cardBody}>
          Vazifalarni topshirish va baholarni ko&apos;rish funksiyasi
          ishlab chiqilmoqda.
        </Text>
      </View>
    </ScrollView>
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
  title: {
    ...typography.h1,
    color: colors.cream,
  },
  subtitle: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.cream,
  },
  cardBody: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.xs,
  },
});

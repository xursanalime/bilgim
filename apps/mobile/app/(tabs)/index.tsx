/**
 * Home tab — placeholder dashboard ("Bosh sahifa"). Phase 22.2 will populate
 * this with enrolled groups, upcoming live sessions, and recent notifications.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { useAuth } from '../../lib/auth-context';
import { colors, radius, spacing, typography } from '../../theme/colors';

export default function HomeScreen() {
  const { user } = useAuth();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Xush kelibsiz!</Text>
          {user ? (
            <Text style={styles.userName}>{user.fullName}</Text>
          ) : null}
        </View>
        <Pressable style={styles.avatar}>
          <Ionicons name="person" size={24} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>12</Text>
          <Text style={styles.statLabel}>Darslar</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>85%</Text>
          <Text style={styles.statLabel}>O'zlashtirish</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>4</Text>
          <Text style={styles.statLabel}>Vazifalar</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Bugungi holat</Text>

      <Pressable style={styles.card}>
        <View style={[styles.cardIcon, { backgroundColor: colors.accentMuted }]}>
          <Ionicons name="book" size={24} color={colors.accent} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Bugungi vazifalar</Text>
          <Text style={styles.cardBody}>
            Hozircha yangi vazifalar yo&apos;q.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.creamDim} />
      </Pressable>

      <Pressable style={styles.card}>
        <View style={[styles.cardIcon, { backgroundColor: 'rgba(96, 165, 250, 0.15)' }]}>
          <Ionicons name="videocam" size={24} color={colors.info} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Jonli darslar</Text>
          <Text style={styles.cardBody}>
            Rejalashtirilgan darslar yo&apos;q.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.creamDim} />
      </Pressable>

      <Pressable style={styles.card}>
        <View style={[styles.cardIcon, { backgroundColor: 'rgba(251, 191, 36, 0.15)' }]}>
          <Ionicons name="notifications" size={24} color={colors.warning} />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>Xabarnomalar</Text>
          <Text style={styles.cardBody}>Yangi xabarnoma yo&apos;q.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.creamDim} />
      </Pressable>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  greeting: {
    ...typography.body,
    color: colors.creamDim,
  },
  userName: {
    ...typography.h1,
    color: colors.cream,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h2,
    color: colors.cream,
  },
  statLabel: {
    ...typography.caption,
    color: colors.creamDim,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: '60%',
    backgroundColor: colors.inkLine,
    alignSelf: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.cream,
    marginBottom: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.inkLine,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    ...typography.bodyStrong,
    color: colors.cream,
  },
  cardBody: {
    ...typography.caption,
    color: colors.creamDim,
    marginTop: 2,
  },
});

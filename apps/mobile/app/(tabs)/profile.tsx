/**
 * Profile screen — shows the current user and offers a logout button.
 * Logging out clears the SecureStore tokens which the root layout's auth
 * guard observes and redirects to /(auth)/login.
 */

import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { useAuth } from '../../lib/auth-context';
import { colors, radius, spacing, typography } from '../../theme/colors';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      Alert.alert(
        'Xato',
        err instanceof Error ? err.message : "Chiqib bo'lmadi",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.name}>{user?.fullName ?? 'Foydalanuvchi'}</Text>
        <Text style={styles.email}>{user?.email ?? ''}</Text>
        {user ? (
          <Text style={styles.role}>{roleLabel(user.role)}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sozlamalar</Text>
        <Text style={styles.sectionBody}>
          Bildirishnomalar, til, profilni tahrirlash va boshqa sozlamalar
          tez orada qo&apos;shiladi.
        </Text>
      </View>

      <Button
        label="Chiqish"
        variant="danger"
        onPress={handleLogout}
        loading={loggingOut}
        fullWidth
      />
    </ScrollView>
  );
}

function roleLabel(role: 'STUDENT' | 'TEACHER' | 'ADMIN'): string {
  switch (role) {
    case 'STUDENT':
      return 'Talaba';
    case 'TEACHER':
      return "O'qituvchi";
    case 'ADMIN':
      return 'Administrator';
  }
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
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.inkLine,
    marginBottom: spacing.xl,
  },
  name: {
    ...typography.h2,
    color: colors.cream,
  },
  email: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.xs,
  },
  role: {
    ...typography.label,
    color: colors.accent,
    marginTop: spacing.sm,
  },
  section: {
    backgroundColor: colors.inkSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.inkLine,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.cream,
  },
  sectionBody: {
    ...typography.body,
    color: colors.creamDim,
    marginTop: spacing.xs,
  },
});

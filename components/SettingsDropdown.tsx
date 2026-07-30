import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/utils/supabase';

export default function SettingsDropdown() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCommish, setIsCommish] = useState(false);

  useEffect(() => {
    async function checkRole() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('league_members')
        .select('leagues(commissioner_id)')
        .limit(1)
        .maybeSingle();

      const cId = (data as any)?.leagues?.commissioner_id;
      if (cId === user.id) {
        setIsCommish(true);
      }
    }
    checkRole();
  }, []);

  return (
    <View style={styles.anchorContainer}>
      <TouchableOpacity style={styles.cogButton} onPress={() => setMenuOpen(!menuOpen)}>
        <Text style={styles.cogIconText}>⚙️</Text>
      </TouchableOpacity>

      {menuOpen && (
        <View style={styles.dropdownBox}>
          {/* 🚀 FIXED: Added leading slash for absolute route resolution */}
          <TouchableOpacity 
            style={styles.menuItem} 
            onPress={() => { 
              setMenuOpen(false); 
              router.push('/profile'); 
            }}
          >
            <Text style={styles.menuItemText}>👤 My Profile</Text>
          </TouchableOpacity>

          {isCommish && (
            <TouchableOpacity 
              style={styles.menuItem} 
              onPress={() => { 
                setMenuOpen(false); 
                router.push('/(admin)/league-settings'); 
              }}
            >
              <Text style={[styles.menuItemText, { color: '#00ff87' }]}>🛠️ Commissioner Settings</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={[styles.menuItem, { borderBottomWidth: 0 }]} 
            onPress={async () => { 
              setMenuOpen(false); 
              try {
                await supabase.auth.signOut(); 
                router.replace('/(auth)/login');
              } catch (err) {
                console.error("Error signing out:", err);
              }
            }}
          >
            <Text style={[styles.menuItemText, { color: '#FF453A' }]}>➔ Sign Out</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchorContainer: { position: 'relative', zIndex: 999 },
  cogButton: { padding: 6, paddingHorizontal: 10, marginRight: 10 },
  cogIconText: { fontSize: 18, color: '#FFF' },
  dropdownBox: { position: 'absolute', top: 40, right: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 4, width: 190, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 10 },
  menuItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  menuItemText: { color: '#DDD', fontSize: 13, fontWeight: '700' }
});
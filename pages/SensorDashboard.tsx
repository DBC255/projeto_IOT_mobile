import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Switch,
  TextInput,
  Text,
  View,
} from 'react-native';

type SensorStatus = boolean | number;

type Sensor = {
  codigo: string;
  tipo: string;
  status: SensorStatus;
};

type SensorDashboardProps = {
  apiBaseUrl?: string;
};

const DEFAULT_API_BASE_URL = 'http://10.137.11';
const SENSOR_LIST_PATH = '/api/sensor/status/listar';
const SENSOR_VIEW_PATH = '/api/sensor/status/visualizar';
const SENSOR_UPDATE_PATH = '/api/sensor/status/atualizar';

function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function isActive(status: SensorStatus): boolean {
  if (typeof status === 'boolean') return status;
  return Number(status) !== 0 && Number.isFinite(Number(status));
}

function readSensorList(payload: unknown): Sensor[] {
  // Ajustado para ler o JSON direto do Insomnia ou empacotado em .data
  const data = Array.isArray(payload) 
    ? payload 
    : (payload as { data?: unknown } | null)?.data;

  if (!Array.isArray(data)) {
    throw new Error('A resposta da API não contém uma lista válida de sensores.');
  }

  return data.map((item, index) => {
    const sensor = item as Partial<Sensor>;
    if (typeof sensor.codigo !== 'string' || typeof sensor.tipo !== 'string') {
      throw new Error(`Os dados do sensor ${index + 1} estão incompletos.`);
    }
    if (typeof sensor.status !== 'boolean' && typeof sensor.status !== 'number') {
      throw new Error(`O status do sensor ${sensor.codigo} está incompleto.`);
    }
    return {
      codigo: sensor.codigo,
      tipo: sensor.tipo,
      status: sensor.status,
    };
  });
}

export default function SensorDashboard({
  apiBaseUrl = DEFAULT_API_BASE_URL,
}: SensorDashboardProps) {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingCodes, setUpdatingCodes] = useState<string[]>([]);
  const [checkingCodes, setCheckingCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSensors = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('pt-BR');
    if (!query) return sensors;

    return sensors.filter((sensor) =>
      sensor.codigo.toLocaleLowerCase('pt-BR') === query ||
      sensor.tipo.toLocaleLowerCase('pt-BR').includes(query),
    );
  }, [searchTerm, sensors]);

  const loadSensors = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        apiEndpoint(apiBaseUrl, SENSOR_LIST_PATH),
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }
      const payload: unknown = await response.json();
      setSensors(readSensorList(payload));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível carregar os sensores. ${err.message}`
          : 'Não foi possível carregar os sensores. Verifique a conexão com a API.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void loadSensors();
  }, [loadSensors]);

  const refreshSensorStatus = async (sensor: Sensor) => {
    if (checkingCodes.includes(sensor.codigo)) return;
    setCheckingCodes((current) => [...current, sensor.codigo]);
    setError(null);

    try {
      const code = encodeURIComponent(sensor.codigo.toLowerCase());
      const response = await fetch(
        `${apiEndpoint(apiBaseUrl, SENSOR_VIEW_PATH)}/${code}`,
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }

      const result = (await response.json()) as { status?: SensorStatus };
      if (typeof result.status !== 'boolean' && typeof result.status !== 'number') {
        throw new Error('A resposta não contém um status válido.');
      }

      setSensors((current) =>
        current.map((item) =>
          item.codigo === sensor.codigo ? { ...item, status: result.status! } : item,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível consultar ${sensor.codigo}. ${err.message}`
          : `Não foi possível consultar ${sensor.codigo}. Verifique a conexão com a API.`,
      );
    } finally {
      setCheckingCodes((current) => current.filter((code) => code !== sensor.codigo));
    }
  };

  const toggleSensor = async (sensor: Sensor) => {
    const previousStatus = sensor.status;
    const nextStatus = !isActive(previousStatus);

    setSensors((current) =>
      current.map((item) =>
        item.codigo === sensor.codigo ? { ...item, status: nextStatus } : item,
      ),
    );
    setUpdatingCodes((current) => [...current, sensor.codigo]);
    setError(null);

    try {
      const response = await fetch(
        apiEndpoint(apiBaseUrl, SENSOR_UPDATE_PATH),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo: sensor.codigo.toLowerCase(), status: nextStatus }),
        },
      );
      if (!response.ok) {
        throw new Error(`O servidor respondeu com o erro ${response.status}.`);
      }

      const result = (await response.json()) as { status?: SensorStatus };
      if (result.status !== undefined) {
        setSensors((current) =>
          current.map((item) =>
            item.codigo === sensor.codigo ? { ...item, status: result.status! } : item,
          ),
        );
      }
    } catch (err) {
      setSensors((current) =>
        current.map((item) =>
          item.codigo === sensor.codigo ? { ...item, status: previousStatus } : item,
        ),
      );
      setError(
        err instanceof Error
          ? `Não foi possível atualizar ${sensor.codigo}. ${err.message}`
          : `Não foi possível atualizar ${sensor.codigo}. Tente novamente.`,
      );
    } finally {
      setUpdatingCodes((current) => current.filter((code) => code !== sensor.codigo));
    }
  };

  const renderSensor = ({ item }: { item: Sensor }) => {
    const active = isActive(item.status);
    const updating = updatingCodes.includes(item.codigo);
    const checking = checkingCodes.includes(item.codigo);

    return (
      <View style={styles.card}>
        <View style={styles.sensorInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.sensorCode}>{item.codigo.toUpperCase()}</Text>
            <View style={[styles.statusBadge, active ? styles.activeBadge : styles.inactiveBadge]}>
              <View style={[styles.statusDot, active ? styles.activeDot : styles.inactiveDot]} />
              <Text style={[styles.statusText, active ? styles.activeText : styles.inactiveText]}>
                {active ? 'ATIVO' : 'INATIVO'}
              </Text>
            </View>
          </View>
          <Text style={styles.sensorType}>{item.tipo}</Text>
        </View>

        <View style={styles.controlRow}>
          <View style={styles.switchContainer}>
            {updating ? (
              <ActivityIndicator size="small" color="#0284C7" />
            ) : (
              <Switch
                accessibilityLabel={`Alternar sensor ${item.codigo}`}
                value={active}
                onValueChange={() => void toggleSensor(item)}
                trackColor={{ false: '#E2E8F0', true: '#BAE6FD' }}
                thumbColor={active ? '#0284C7' : '#94A3B8'}
              />
            )}
          </View>
          
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Consultar status de ${item.codigo}`}
            disabled={checking}
            onPress={() => void refreshSensorStatus(item)}
            style={[styles.queryButton, checking && styles.queryButtonDisabled]}
          >
            {checking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.queryButtonText}>Atualizar</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Painel de Sensores</Text>
          <Text style={styles.subtitle}>Gerenciamento de dispositivos em tempo real.</Text>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            accessibilityLabel="Buscar sensor por código ou tipo"
            placeholder="Filtrar por código ou tipo..."
            placeholderTextColor="#94A3B8"
            value={searchTerm}
            onChangeText={setSearchTerm}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searchTerm.length > 0 ? (
            <Pressable onPress={() => setSearchTerm('')} hitSlop={8}>
              <Text style={styles.clearSearch}>Limpar</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void loadSensors()} style={styles.retryButton}>
              <Text style={styles.retryText}>Recarregar Lista</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#0284C7" />
            ) : (
<FlatList
data={filteredSensors}
keyExtractor={(item) => item.codigo}
renderItem={renderSensor}
contentContainerStyle={filteredSensors.length === 0 ? styles.emptyList : styles.list}
refreshControl={
<RefreshControl refreshing={refreshing} onRefresh={() => void loadSensors(true)} colors={['#0284C7']} />
}
ListEmptyComponent={
}
showsVerticalScrollIndicator={false}
/>
)}


);
}
const styles = StyleSheet.create({
safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
container: { flex: 1, paddingHorizontal: 16 },
header: { paddingTop: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginBottom: 16 },
heading: { color: '#0F172A', fontSize: 24, fontWeight: '700' },
subtitle: { color: '#64748B', fontSize: 14, marginTop: 4 },
searchBox: {
alignItems: 'center',
backgroundColor: '#FFFFFF',
borderColor: '#CBD5E1',
borderRadius: 8,
borderWidth: 1,
flexDirection: 'row',
marginBottom: 16,
minHeight: 44,
paddingHorizontal: 12,
},
searchIcon: { fontSize: 16, marginRight: 8, color: '#64748B' },
searchInput: { color: '#0F172A', flex: 1, fontSize: 14, paddingVertical: 8 },
clearSearch: { color: '#0284C7', fontSize: 13, fontWeight: '600', paddingLeft: 8 },
list: { paddingBottom: 20 },
emptyList: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
card: {
backgroundColor: '#FFFFFF',
borderColor: '#E2E8F0',
borderRadius: 12,
borderWidth: 1,
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
marginBottom: 12,
padding: 16,
shadowColor: '#000',
shadowOffset: { width: 0, height: 1 },
shadowOpacity: 0.05,
shadowRadius: 2,
elevation: 2,
},
sensorInfo: { flex: 1, paddingRight: 12 },
titleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
sensorCode: { color: '#0F172A', fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
sensorType: { color: '#64748B', fontSize: 13, marginTop: 4, textTransform: 'uppercase', fontWeight: '500' },
statusBadge: { alignItems: 'center', borderRadius: 6, flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 4 },
activeBadge: { backgroundColor: '#DCFCE7' },
inactiveBadge: { backgroundColor: '#F1F5F9' },
statusDot: { borderRadius: 99, height: 6, width: 6 },
activeDot: { backgroundColor: '#16A34A' },
inactiveDot: { backgroundColor: '#64748B' },
statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
activeText: { color: '#15803D' },
inactiveText: { color: '#475569' },
controlRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
switchContainer: { minWidth: 50, alignItems: 'center' },
queryButton: { backgroundColor: '#0284C7', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, minWidth: 80, alignItems: 'center', justifyContent: 'center' },
queryButtonDisabled: { backgroundColor: '#94A3B8' },
queryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
loading: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 12 },
loadingText: { color: '#64748B', fontSize: 14, fontWeight: '500' },
errorBox: { backgroundColor: '#FEF2F2', borderRadius: 8, borderWidth: 1, borderColor: '#FEE2E2', marginBottom: 16, padding: 16 },
errorText: { color: '#991B1B', fontSize: 13, lineHeight: 20 },
retryButton: { marginTop: 10, backgroundColor: '#DC2626', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
emptyText: { color: '#64748B', fontSize: 14, textAlign: 'center' },
});
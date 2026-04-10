'use client';

import { useState, useEffect } from 'react';
import { 
    ShoppingBag, 
    Truck, 
    Clock, 
    CheckCircle, 
    ArrowRight, 
    Package, 
    ExternalLink,
    Loader2,
    Filter
} from 'lucide-react';
import { apiFulfillment, OrderItem } from '@/lib/api';
import { toast } from 'react-hot-toast';

export function OrdersClient() {
    const [orders, setOrders] = useState<OrderItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadOrders();
    }, []);

    const loadOrders = async () => {
        try {
            // Mocking for now as the backend route is just starting
            const data = await apiFulfillment.listOrders().catch(() => [
                { id: '349021', customer: 'Alice Smith', product: 'Vintage Mountain Tee', sku: 'MNT-001', designUrl: '', status: 'AWAITING_FULFILLMENT' },
                { id: '349022', customer: 'Bob Jones', product: 'Retro Eagle Hoodie', sku: 'EAG-002', designUrl: '', status: 'IN_PRODUCTION' },
            ] as OrderItem[]);
            setOrders(data);
        } catch (err) {
            toast.error('Failed to load orders');
        } finally {
            setLoading(false);
        }
    };

    const handleFulfill = async (id: string) => {
        const toastId = toast.loading('Sending order to factory...');
        try {
            await apiFulfillment.submitOrder(id);
            toast.success('Order sent to production!', { id: toastId });
            loadOrders();
        } catch (err) {
            toast.error('Submission failed', { id: toastId });
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
                        <ShoppingBag className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-text-primary">Etsy Orders & Fulfillment</h1>
                        <p className="text-xs text-text-tertiary">Production sync with Yuppion Factory</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button className="h-9 px-4 rounded-lg bg-bg-elevated border border-border-subtle text-xs font-medium text-text-secondary flex items-center gap-2">
                        <Filter className="w-3.5 h-3.5" />
                        Filter
                    </button>
                    <button 
                        onClick={loadOrders}
                        className="h-9 px-4 rounded-lg bg-accent text-white text-xs font-bold hover:scale-105 transition-all"
                    >
                        Sync Etsy Orders
                    </button>
                </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
                        <Clock className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Awaiting</p>
                        <p className="text-lg font-bold text-text-primary">12 Orders</p>
                    </div>
                </div>
                <div className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500">
                        <Package className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">In Production</p>
                        <p className="text-lg font-bold text-text-primary">5 Orders</p>
                    </div>
                </div>
                <div className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-green-500/10 text-green-500">
                        <Truck className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Shipped Today</p>
                        <p className="text-lg font-bold text-text-primary">8 Orders</p>
                    </div>
                </div>
            </div>

            {/* Orders Table */}
            <div className="bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-bg-base/50 text-[11px] font-bold text-text-tertiary uppercase tracking-widest">
                            <th className="px-6 py-4">Order ID</th>
                            <th className="px-6 py-4">Customer</th>
                            <th className="px-6 py-4">Product / SKU</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-text-tertiary">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                    Scanning Etsy Shop...
                                </td>
                            </tr>
                        ) : orders.map(order => (
                            <tr key={order.id} className="text-sm hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4 font-mono text-xs text-text-tertiary">#{order.id}</td>
                                <td className="px-6 py-4 font-medium text-text-primary">{order.customer}</td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="text-text-secondary">{order.product}</span>
                                        <span className="text-[10px] text-text-tertiary font-mono">{order.sku}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                                        order.status === 'AWAITING_FULFILLMENT' ? 'bg-amber-500/10 text-amber-500' :
                                        order.status === 'IN_PRODUCTION' ? 'bg-blue-500/10 text-blue-500' :
                                        'bg-green-500/10 text-green-500'
                                    }`}>
                                        <Clock className="w-3 h-3" />
                                        {order.status.replace('_', ' ')}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {order.status === 'AWAITING_FULFILLMENT' ? (
                                        <button 
                                            onClick={() => handleFulfill(order.id)}
                                            className="h-8 px-4 rounded-lg bg-accent text-white text-[11px] font-bold flex items-center gap-2 hover:scale-105 ml-auto transition-all"
                                        >
                                            Fulfill <ArrowRight className="w-3 h-3" />
                                        </button>
                                    ) : (
                                        <button className="text-text-tertiary hover:text-text-primary transition-colors">
                                            <ExternalLink className="w-4 h-4 ml-auto" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Info Box */}
            <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-4">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 animate-pulse" />
                <p className="text-[11px] text-text-secondary leading-relaxed">
                    Orders are automatically fetched from your Etsy store. Clicking "Fulfill" will send the design to your configured POD factory (Yuppion). Once the factory ships, the tracking code will be automatically updated on Etsy.
                </p>
            </div>
        </div>
    );
}
